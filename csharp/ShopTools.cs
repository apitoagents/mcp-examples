using System.ComponentModel;
using System.Text.Json.Serialization;
using ModelContextProtocol;
using ModelContextProtocol.Server;

// Assistants read results as text; keep them short and never include fields
// the user has no business seeing.
public sealed record ProductSummary(string Id, string Name, string Category, string Price, bool InStock, string? Description = null);

// nextCursor must always be present, even when null: it is how the assistant
// knows the page was the last one. The SDK's serializer omits nulls by default.
public sealed record SearchResult(
    List<ProductSummary> Items,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor);

[McpServerToolType]
public sealed class ShopTools(ShopClient shop)
{
    private static ProductSummary Summary(Product p, bool withDescription = false) => new(
        p.Id,
        p.Name,
        p.Category,
        $"${p.PriceCents / 100.0:F2}",
        p.InStock,
        withDescription ? p.Description : null);

    // McpException surfaces to the assistant as an isError result whose text
    // tells it what to do next.
    private static McpException Explain(UpstreamException e) => e.Kind switch
    {
        UpstreamKind.InvalidInput => new($"Invalid input: {e.Message} Adjust the arguments and call again."),
        UpstreamKind.NotFound => new($"Not found: {e.Message} Do not retry with the same identifier; ask the user to check it."),
        UpstreamKind.Conflict => new($"Conflict: {e.Message} Do not retry automatically; tell the user what happened."),
        _ => new($"The shop service is unavailable right now: {e.Message} Wait before retrying, and tell the user."),
    };

    [McpServerTool(Name = "search_products", Title = "Search products", ReadOnly = true, OpenWorld = false)]
    [Description("Search the shop catalogue by phrase and optional category. Returns one page of up to `limit` products and a `nextCursor`; when nextCursor is not null, more results exist and you must say so rather than claiming the list is complete. Use get_product for full details of one item. This tool does not place orders.")]
    public async Task<SearchResult> SearchProducts(
        [Description("Words to match against product names and descriptions.")] string? query = null,
        [Description("Restrict results to one category: lighting, furniture or kitchen.")] string? category = null,
        [Description("Page size, 1 to 20.")] int limit = 5,
        [Description("Opaque token from a previous page's nextCursor. Never invent one.")] string? cursor = null,
        CancellationToken ct = default)
    {
        try
        {
            var page = await shop.SearchProducts(query, category, limit, cursor, ct);
            return new SearchResult(page.Items.Select(p => Summary(p)).ToList(), page.NextCursor);
        }
        catch (UpstreamException e) { throw Explain(e); }
    }

    [McpServerTool(Name = "get_product", Title = "Get product details", ReadOnly = true, OpenWorld = false)]
    [Description("Return the full details of one product by its id (for example p-1001). Use search_products first if you only know a name.")]
    public async Task<ProductSummary> GetProduct(
        [Description("The product id from search_products.")] string productId,
        CancellationToken ct = default)
    {
        try
        {
            return Summary(await shop.GetProduct(productId, ct), withDescription: true);
        }
        catch (UpstreamException e) { throw Explain(e); }
    }

    [McpServerTool(Name = "create_order", Title = "Create an order", ReadOnly = false, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Place an order for one product. Generate one random idempotencyKey per user request and reuse the same key if you retry after an error or timeout; the shop returns the original order instead of creating a duplicate. Confirm product and quantity with the user before calling. Returns the order with its id, status and total.")]
    public async Task<object> CreateOrder(
        [Description("Product id from search_products or get_product.")] string productId,
        [Description("Units to order, 1 to 10.")] int quantity,
        [Description("A unique key you generate for this order attempt and reuse on retry (8 to 128 characters).")] string idempotencyKey,
        CancellationToken ct = default)
    {
        try
        {
            var o = await shop.CreateOrder(productId, quantity, idempotencyKey, ct);
            return new { id = o.Id, productId = o.ProductId, quantity = o.Quantity, status = o.Status, totalCents = o.TotalCents, currency = o.Currency, total = $"${o.TotalCents / 100.0:F2}" };
        }
        catch (UpstreamException e) { throw Explain(e); }
    }

    [McpServerTool(Name = "cancel_order", Title = "Cancel an order", ReadOnly = false, Destructive = true, Idempotent = true, OpenWorld = false)]
    [Description("Cancel an order that has not shipped. This cannot be undone. Call it first with confirm=false to get the order details, show them to the user, and only after the user explicitly agrees call again with confirm=true.")]
    public async Task<object> CancelOrder(
        [Description("The order id, for example o-5001.")] string orderId,
        [Description("Set true only after the user has explicitly confirmed the cancellation.")] bool confirm = false,
        CancellationToken ct = default)
    {
        try
        {
            if (!confirm)
            {
                var o = await shop.GetOrder(orderId, ct);
                throw new McpException(
                    $"Confirmation required. Order {o.Id}: {o.Quantity} × {o.ProductId}, status {o.Status}, total ${o.TotalCents / 100.0:F2}. " +
                    "Ask the user to confirm, then call cancel_order again with confirm=true.");
            }
            return await shop.CancelOrder(orderId, ct);
        }
        catch (UpstreamException e) { throw Explain(e); }
    }
}
