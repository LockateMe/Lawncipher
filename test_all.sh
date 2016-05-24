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
echo "Pearson hashing"
node tests/pearsonhasher.js
echo "Pearson ranges"
node tests/pearsonrange.js
echo "Pearson-based B+ trees"
node tests/pearsonbplustree.js

echo ""
echo "-----------------------------------"
echo "Unit testing Lawncipher"
echo "-----------------------------------"
echo ""
node test.js
