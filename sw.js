// SOLIDARIDAD sw.js - Version 8.1 (Network First - Force Refresh)
var CACHE_NAME = 'solidaridad-cache-v115';

self.addEventListener('install', function(e) {
    self.skipWaiting(); // Force the waiting service worker to become the active service worker.
});

self.addEventListener('activate', function(e) {
    e.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    return caches.delete(cacheName); // Delete all old caches
                })
            );
        }).then(function() {
            return self.clients.claim(); // Take control of all clients immediately
        })
    );
});

self.addEventListener('fetch', function(e) {
    // Network first, fallback to cache (if any)
    e.respondWith(
        fetch(e.request).catch(function() {
            return caches.match(e.request);
        })
    );
});
















































