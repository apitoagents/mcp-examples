<?php

declare(strict_types=1);

namespace SampleShop;

/**
 * A thin client for the Sample Shop API.
 *
 * The MCP server never exposes the upstream credential to the assistant: it is
 * read from the environment here and attached to every request.
 */
final class ShopClient
{
    private readonly string $baseUrl;
    private readonly string $apiKey;

    public function __construct(?string $baseUrl = null, ?string $apiKey = null)
    {
        $this->baseUrl = rtrim($baseUrl ?? getenv('UPSTREAM_URL') ?: 'http://127.0.0.1:4010', '/');
        $this->apiKey = $apiKey ?? (getenv('UPSTREAM_API_KEY') ?: 'demo-key');
    }

    /** @return array<string, mixed> */
    private function request(string $method, string $path, array $headers = [], ?array $json = null): array
    {
        $headerLines = ['X-API-Key: ' . $this->apiKey, 'Content-Type: application/json', 'Accept: application/json'];
        foreach ($headers as $name => $value) {
            $headerLines[] = $name . ': ' . $value;
        }
        $context = stream_context_create(['http' => [
            'method' => $method,
            'header' => implode("\r\n", $headerLines),
            'content' => $json === null ? '' : json_encode($json, JSON_THROW_ON_ERROR),
            'timeout' => 5,
            'ignore_errors' => true,
        ]]);
        $body = @file_get_contents($this->baseUrl . $path, false, $context);
        if ($body === false) {
            throw new UpstreamException('unavailable', 'The shop API did not respond.');
        }
        $status = 0;
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                $status = (int) $m[1];
            }
        }
        $data = json_decode($body, true);
        if ($status >= 200 && $status < 300 && is_array($data)) {
            return $data;
        }
        $message = is_array($data) && isset($data['message']) ? (string) $data['message'] : 'HTTP ' . $status;
        throw match ($status) {
            400 => new UpstreamException('invalid_input', $message),
            404 => new UpstreamException('not_found', $message),
            409 => new UpstreamException('conflict', $message),
            default => new UpstreamException('unavailable', "The shop API returned {$status}: {$message}"),
        };
    }

    /** @param array<string, scalar|null> $params */
    public function searchProducts(array $params): array
    {
        $clean = array_filter($params, static fn ($v) => $v !== null && $v !== '');
        return $this->request('GET', '/products?' . http_build_query($clean));
    }

    public function getProduct(string $id): array
    {
        return $this->request('GET', '/products/' . rawurlencode($id));
    }

    public function createOrder(string $productId, int $quantity, string $idempotencyKey): array
    {
        return $this->request('POST', '/orders', ['Idempotency-Key' => $idempotencyKey], [
            'productId' => $productId,
            'quantity' => $quantity,
        ]);
    }

    public function getOrder(string $id): array
    {
        return $this->request('GET', '/orders/' . rawurlencode($id));
    }

    public function cancelOrder(string $id): array
    {
        return $this->request('POST', '/orders/' . rawurlencode($id) . '/cancel');
    }
}

/** One of the four outcomes an assistant must handle differently. */
final class UpstreamException extends \RuntimeException
{
    public function __construct(public readonly string $kind, string $message)
    {
        parent::__construct($message);
    }
}
