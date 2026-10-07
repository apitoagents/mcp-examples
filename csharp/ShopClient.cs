// A thin client for the Sample Shop API. The MCP server never exposes the
// upstream credential to the assistant: it is read from the environment here
// and attached to every request.
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

public enum UpstreamKind { InvalidInput, NotFound, Conflict, Unavailable }

public sealed class UpstreamException(UpstreamKind kind, string message) : Exception(message)
{
    public UpstreamKind Kind { get; } = kind;
}

public sealed record Product(
    string Id,
    string Name,
    string? Description,
    string Category,
    int PriceCents,
    string Currency,
    bool InStock);

public sealed record ProductPage(List<Product> Items, string? NextCursor);

public sealed record Order(
    string Id,
    string ProductId,
    int Quantity,
    string Status,
    int TotalCents,
    string Currency);

sealed record ApiError(string? Code, string? Message);

public sealed class ShopClient
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
    private readonly HttpClient http;

    public ShopClient()
    {
        var baseUrl = Environment.GetEnvironmentVariable("UPSTREAM_URL") ?? "http://127.0.0.1:4010";
        var apiKey = Environment.GetEnvironmentVariable("UPSTREAM_API_KEY") ?? "demo-key";
        http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(5) };
        http.DefaultRequestHeaders.Add("X-API-Key", apiKey);
    }

    private async Task<T> Send<T>(HttpRequestMessage request, CancellationToken ct)
    {
        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, ct);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            throw new UpstreamException(UpstreamKind.Unavailable, $"The shop API did not respond: {e.Message}");
        }
        if (response.IsSuccessStatusCode)
            return (await response.Content.ReadFromJsonAsync<T>(Json, ct))!;
        ApiError? error = null;
        try { error = await response.Content.ReadFromJsonAsync<ApiError>(Json, ct); } catch (JsonException) { }
        var message = error?.Message ?? response.ReasonPhrase ?? "error";
        throw response.StatusCode switch
        {
            HttpStatusCode.BadRequest => new UpstreamException(UpstreamKind.InvalidInput, message),
            HttpStatusCode.NotFound => new UpstreamException(UpstreamKind.NotFound, message),
            HttpStatusCode.Conflict => new UpstreamException(UpstreamKind.Conflict, message),
            _ => new UpstreamException(UpstreamKind.Unavailable, $"The shop API returned {(int)response.StatusCode}: {message}"),
        };
    }

    public Task<ProductPage> SearchProducts(string? q, string? category, int limit, string? cursor, CancellationToken ct)
    {
        var query = new List<string>();
        if (!string.IsNullOrEmpty(q)) query.Add($"q={Uri.EscapeDataString(q)}");
        if (!string.IsNullOrEmpty(category)) query.Add($"category={Uri.EscapeDataString(category)}");
        query.Add($"limit={limit}");
        if (!string.IsNullOrEmpty(cursor)) query.Add($"cursor={Uri.EscapeDataString(cursor)}");
        return Send<ProductPage>(new(HttpMethod.Get, $"/products?{string.Join('&', query)}"), ct);
    }

    public Task<Product> GetProduct(string id, CancellationToken ct) =>
        Send<Product>(new(HttpMethod.Get, $"/products/{Uri.EscapeDataString(id)}"), ct);

    public Task<Order> CreateOrder(string productId, int quantity, string idempotencyKey, CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/orders")
        {
            Content = JsonContent.Create(new { productId, quantity }, options: Json),
        };
        request.Headers.Add("Idempotency-Key", idempotencyKey);
        return Send<Order>(request, ct);
    }

    public Task<Order> GetOrder(string id, CancellationToken ct) =>
        Send<Order>(new(HttpMethod.Get, $"/orders/{Uri.EscapeDataString(id)}"), ct);

    public Task<Order> CancelOrder(string id, CancellationToken ct) =>
        Send<Order>(new(HttpMethod.Post, $"/orders/{Uri.EscapeDataString(id)}/cancel"), ct);
}
