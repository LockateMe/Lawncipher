#! /bin/sh

set -e

if [ -d "./test_db" ]; then
	rm -r ./test_db
fi
if [ -d "./tests/test_index" ]; then
	rm -r ./tests/test_index
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
echo "Splitted indexes"
mkdir -p tests/test_index
node tests/splitindex.js

echo ""
echo "-----------------------------------"
echo "Unit testing Lawncipher"
echo "-----------------------------------"
echo ""
node test.js
