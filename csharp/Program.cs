// MCP server for the Sample Shop API, served over Streamable HTTP with ASP.NET Core.
// Four tools show the three kinds every integration needs: read tools
// (search_products, get_product), an idempotent write (create_order), and a
// guarded action that refuses to run without explicit confirmation (cancel_order).
using ModelContextProtocol.Server;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<ShopClient>();
builder.Services
    .AddMcpServer(options =>
    {
        options.ServerInfo = new() { Name = "sample-shop", Version = "1.0.0" };
        options.ServerInstructions =
            "Tools for the Sample Shop. Search and look up products freely. " +
            "Confirm product and quantity with the user before create_order. " +
            "cancel_order is irreversible and must be confirmed by the user first.";
    })
    // Stateless: nothing is held between calls, so the endpoint scales horizontally.
    .WithHttpTransport(options => options.Stateless = true)
    .WithTools<ShopTools>();

var app = builder.Build();
app.MapMcp("/mcp");
app.MapGet("/health", () => Results.Json(new { ok = true }));

var host = Environment.GetEnvironmentVariable("HOST") ?? "127.0.0.1";
var port = Environment.GetEnvironmentVariable("PORT") ?? "3003";
Console.WriteLine($"sample-shop MCP (C#) on http://{host}:{port}/mcp");
app.Run($"http://{host}:{port}");
