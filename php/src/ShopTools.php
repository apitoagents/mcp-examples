<?php

declare(strict_types=1);

namespace SampleShop;

use Mcp\Capability\Attribute\McpTool;
use Mcp\Capability\Attribute\Schema;
use Mcp\Exception\ToolCallException;
use Mcp\Schema\ToolAnnotations;

/**
 * Four tools show the three kinds every integration needs: read tools
 * (search_products, get_product), an idempotent write (create_order), and a
 * guarded action that refuses to run without explicit confirmation (cancel_order).
 */
final class ShopTools
{
    private readonly ShopClient $shop;

    public function __construct()
    {
        $this->shop = new ShopClient();
    }

    /** Assistants read results as text; keep them short and never leak fields. */
    private static function summary(array $p): array
    {
        return [
            'id' => $p['id'],
            'name' => $p['name'],
            'category' => $p['category'],
            'price' => sprintf('$%.2f', $p['priceCents'] / 100),
            'inStock' => $p['inStock'],
        ];
    }

    /** ToolCallException reaches the assistant as isError with text saying what to do next. */
    private static function explain(UpstreamException $e): ToolCallException
    {
        return match ($e->kind) {
            'invalid_input' => new ToolCallException("Invalid input: {$e->getMessage()} Adjust the arguments and call again."),
            'not_found' => new ToolCallException("Not found: {$e->getMessage()} Do not retry with the same identifier; ask the user to check it."),
            'conflict' => new ToolCallException("Conflict: {$e->getMessage()} Do not retry automatically; tell the user what happened."),
            default => new ToolCallException("The shop service is unavailable right now: {$e->getMessage()} Wait before retrying, and tell the user."),
        };
    }

    #[McpTool(
        name: 'search_products',
        title: 'Search products',
        description: 'Search the shop catalogue by phrase and optional category. Returns one page of up to `limit` products and a `nextCursor`; when nextCursor is not null, more results exist and you must say so rather than claiming the list is complete. Use get_product for full details of one item. This tool does not place orders.',
        annotations: new ToolAnnotations(readOnlyHint: true, openWorldHint: false),
    )]
    public function searchProducts(
        #[Schema(description: 'Words to match against product names and descriptions.', maxLength: 100)]
        string $query = '',
        #[Schema(description: 'Restrict results to one category.', enum: ['lighting', 'furniture', 'kitchen'])]
        ?string $category = null,
        #[Schema(description: 'Page size.', minimum: 1, maximum: 20)]
        int $limit = 5,
        #[Schema(description: "Opaque token from a previous page's nextCursor. Never invent one.")]
        ?string $cursor = null,
    ): array {
        try {
            $page = $this->shop->searchProducts(['q' => $query, 'category' => $category, 'limit' => $limit, 'cursor' => $cursor]);
        } catch (UpstreamException $e) {
            throw self::explain($e);
        }
        return ['items' => array_map(self::summary(...), $page['items']), 'nextCursor' => $page['nextCursor']];
    }

    #[McpTool(
        name: 'get_product',
        title: 'Get product details',
        description: 'Return the full details of one product by its id (for example p-1001). Use search_products first if you only know a name.',
        annotations: new ToolAnnotations(readOnlyHint: true, openWorldHint: false),
    )]
    public function getProduct(
        #[Schema(description: 'The product id from search_products.')]
        string $productId,
    ): array {
        try {
            $p = $this->shop->getProduct($productId);
        } catch (UpstreamException $e) {
            throw self::explain($e);
        }
        return self::summary($p) + ['description' => $p['description'] ?? null];
    }

    #[McpTool(
        name: 'create_order',
        title: 'Create an order',
        description: 'Place an order for one product. Generate one random idempotencyKey per user request and reuse the same key if you retry after an error or timeout; the shop returns the original order instead of creating a duplicate. Confirm product and quantity with the user before calling. Returns the order with its id, status and total.',
        annotations: new ToolAnnotations(readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false),
    )]
    public function createOrder(
        #[Schema(description: 'Product id from search_products or get_product.')]
        string $productId,
        #[Schema(description: 'Units to order, 1 to 10.', minimum: 1, maximum: 10)]
        int $quantity,
        #[Schema(description: 'A unique key you generate for this order attempt and reuse on retry.', minLength: 8, maxLength: 128)]
        string $idempotencyKey,
    ): array {
        try {
            $order = $this->shop->createOrder($productId, $quantity, $idempotencyKey);
        } catch (UpstreamException $e) {
            throw self::explain($e);
        }
        return $order + ['total' => sprintf('$%.2f', $order['totalCents'] / 100)];
    }

    #[McpTool(
        name: 'cancel_order',
        title: 'Cancel an order',
        description: 'Cancel an order that has not shipped. This cannot be undone. Call it first with confirm=false to get the order details, show them to the user, and only after the user explicitly agrees call again with confirm=true.',
        annotations: new ToolAnnotations(readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false),
    )]
    public function cancelOrder(
        #[Schema(description: 'The order id, for example o-5001.')]
        string $orderId,
        #[Schema(description: 'Set true only after the user has explicitly confirmed the cancellation.')]
        bool $confirm = false,
    ): array {
        try {
            if (!$confirm) {
                $o = $this->shop->getOrder($orderId);
                throw new ToolCallException(sprintf(
                    'Confirmation required. Order %s: %d × %s, status %s, total $%.2f. Ask the user to confirm, then call cancel_order again with confirm=true.',
                    $o['id'],
                    $o['quantity'],
                    $o['productId'],
                    $o['status'],
                    $o['totalCents'] / 100,
                ));
            }
            return $this->shop->cancelOrder($orderId);
        } catch (UpstreamException $e) {
            throw self::explain($e);
        }
    }
}
