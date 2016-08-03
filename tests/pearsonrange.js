var assert = require('assert');
var Lawncipher = require('../');
var Long = require('long');

Lawncipher.init();

var maxRangeString = '0000000000000000_ffffffffffffffff';
var lowEnd = new Long(0x00000000, 0x00000000, true);
var highEnd = new Long(0xFFFFFFFF, 0xFFFFFFFF, true);

var PearsonRange = Lawncipher.PearsonRange;

var bufferBEToLong = Lawncipher.bufferBEToLong;
var longToBufferBE = Lawncipher.longToBufferBE;
var randomBuffer = Lawncipher.randomBuffer;

assert(bufferBEToLong(longToBufferBE(highEnd)).equals(highEnd));
assert(bufferBEToLong(longToBufferBE(lowEnd)).equals(lowEnd));

var maxRange = new PearsonRange(new Long(0x00000000, 0x00000000, true), new Long(0xFFFFFFFF, 0xFFFFFFFF, true));
var maxRangeFromString = PearsonRange.fromString(maxRangeString);

assert(maxRange.equals(maxRangeFromString));

assert(maxRange.start.equals(lowEnd));
assert(maxRange.end.equals(highEnd));
assert(maxRange.toString().toLowerCase() == maxRangeString);
assert(maxRange.width.equals(highEnd)); //2^64

var split1 = maxRange.split();
var part1 = split1[0];
var part2 = split1[1];

assert(part1.start.equals(lowEnd));
assert(part1.end.equals(highEnd.sub(lowEnd).shru(1)));
//console.log(part1.toString());
assert(part1.toString().toLowerCase() == '0000000000000000_7fffffffffffffff');
assert(part1.width.equals(Long.fromNumber(1).shiftLeft(63).sub(1)));

assert(part2.start.equals(highEnd.sub(lowEnd).shru(1).add(1)));
assert(part2.end.equals(highEnd));
assert(part2.start.equals(part1.end.add(1)));
//console.log(part2.toString());
assert(part2.toString().toLowerCase() == '8000000000000000_ffffffffffffffff');
assert(part2.width.equals(Long.fromNumber(1).shiftLeft(63).sub(1)));

var split2_1 = part1.split();
var split2_2 = part2.split();

var part1_1 = split2_1[0];
var part1_2 = split2_1[1];
var part2_1 = split2_2[0];
var part2_2 = split2_2[1];

assert(part1_1.width.equals(part1_2.width));
assert(part2_1.width.equals(part2_2.width));
assert(part1_2.width.equals(part2_1.width));
assert(part1_1.toString().toLowerCase() == '0000000000000000_3fffffffffffffff');
assert(part1_2.toString().toLowerCase() == '4000000000000000_7fffffffffffffff');
assert(part2_1.toString().toLowerCase() == '8000000000000000_bfffffffffffffff');
assert(part2_2.toString().toLowerCase() == 'c000000000000000_ffffffffffffffff');

//Testing range membership
assert(part1.containsRange(part1_1));
assert(part1.containsRange(part1_2));
assert(part1.isContainedIn(maxRange));
assert(!part1.containsRange(part2_1));
assert(!part1.containsRange(part2_2));

assert(part2.containsRange(part2_1));
assert(part2.containsRange(part2_2));
assert(part2.isContainedIn(maxRange));
assert(!part2.containsRange(part1_1));
assert(!part2.containsRange(part1_2));

//Testing hash membership
assert(maxRange.contains(PearsonRange.MAX_RANGE.start));
assert(maxRange.contains(PearsonRange.MAX_RANGE.end));
assert(part1.contains(PearsonRange.MAX_RANGE.start));
assert(part2.contains(PearsonRange.MAX_RANGE.end));
assert(maxRange.contains(bufferBEToLong(randomBuffer(8))));
