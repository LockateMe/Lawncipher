#! /bin/sh

echo "-----------------------------------"
echo "Unit testing Lawncipher's internals"
echo "-----------------------------------"
echo ""
echo "LRU String Set"
node tests/lru.js

echo "-----------------------------------"
echo "Unit testing Lawncipher"
echo "-----------------------------------"
echo ""
node test.js
