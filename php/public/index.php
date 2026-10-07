<?php

declare(strict_types=1);

// MCP server for the Sample Shop API, served over Streamable HTTP.
// Run locally with:  php -S 127.0.0.1:3004 public/index.php
// Every HTTP request builds the server, handles one MCP message, and exits,
// which is the natural PHP model; sessions live in a file store between requests.

use Http\Discovery\Psr17Factory;
use Laminas\HttpHandlerRunner\Emitter\SapiEmitter;
use Mcp\Server;
use Mcp\Server\Session\FileSessionStore;
use Mcp\Server\Transport\StreamableHttpTransport;

require __DIR__ . '/../vendor/autoload.php';

if (($_SERVER['REQUEST_URI'] ?? '/') === '/health') {
    header('Content-Type: application/json');
    echo '{"ok":true}';
    exit;
}

$factory = new Psr17Factory();
$request = $factory->createServerRequestFromGlobals();

$server = Server::builder()
    ->setServerInfo('sample-shop', '1.0.0')
    ->setInstructions(
        'Tools for the Sample Shop. Search and look up products freely. '
        . 'Confirm product and quantity with the user before create_order. '
        . 'cancel_order is irreversible and must be confirmed by the user first.'
    )
    ->setDiscovery(dirname(__DIR__), ['src'])
    ->setSession(new FileSessionStore(sys_get_temp_dir() . '/sample-shop-mcp-sessions'))
    ->build();

$response = $server->run(new StreamableHttpTransport($request));
(new SapiEmitter())->emit($response);
