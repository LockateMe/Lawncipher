#! /bin/sh

if [ -d "./test_db" ]; then
	rm -r ./test_db
fi

echo "-----------------------------------"
echo "Unit testing Lawncipher's internals"
echo "-----------------------------------"
echo ""
echo "LRU String Set"
node tests/lru.js
echo "Pearson Seed Generator"
node tests/pearsonseedgenerator.js

echo ""
echo "-----------------------------------"
echo "Unit testing Lawncipher"
echo "-----------------------------------"
echo ""
node test.js
