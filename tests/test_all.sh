#! /bin/sh

set -e

if [ -d "./test_db" ]; then
	rm -r ./test_db
fi
if [ -d "./test_index" ]; then
	rm -r ./test_index
fi

echo "-----------------------------------"
echo "Unit testing Lawncipher's internals"
echo "-----------------------------------"
echo ""
echo "to_string() with big Uint8Arrays"
node tostring.js
echo "LRU String Set"
node lru.js
echo "Pearson Seed Generator"
node pearsonseedgenerator.js
echo "Pearson hashing"
node pearsonhasher.js
echo "Pearson ranges"
node pearsonrange.js
echo "Pearson-based B+ trees"
node pearsonbplustree.js
echo "Splitted indexes"
mkdir -p test_index
node splitindex.js

echo ""
echo "-----------------------------------"
echo "Unit testing Lawncipher"
echo "-----------------------------------"
echo ""
node unit_test.js

echo ""
echo "-----------------------------------"
echo "Migration testing (from v1)"
echo "-----------------------------------"
echo ""
./migrate.sh

