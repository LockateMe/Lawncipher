var assert = require('assert');
var Lawncipher = require('../');

var LRUStringSet = Lawncipher.LRUStringSet;

var lruSet = new LRUStringSet();

assert(lruSet.put('a') == 1);
assert(lruSet.put('b') == 2);
assert(lruSet.put('c') == 3);
assert(lruSet.put('c') == 3);
assert(lruSet.put('a') == 3);

//Expected LRU order : [b, c, a]
assert(lruSet.lru() == 'b');
assert(lruSet.lru() == 'c');
assert(lruSet.lru() == 'a');
