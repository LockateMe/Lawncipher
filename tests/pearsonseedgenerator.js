var assert = require('assert');
var Lawncipher = require('../');

var yell = process.argv.length > 2 && process.argv[2] == 'verbose';

var PearsonSeedGenerator = Lawncipher.PearsonSeedGenerator;

var s = PearsonSeedGenerator();

var integrityCheckHash = {};
var countOfNeighborNumberIsNeighborIntegerCases = 0;
var countOfUnmovedNumbers = 0;
//Asserting that the seed has the correct length
assert(s.length == 256);

for (var i = 0; i < s.length; i++){
	integrityCheckHash[s[i].toString()] = true;
	//Check that the next number in position is not also the next integer
	if (i < s.length - 1){
		if (s[i] + 1 == s[i+1]) countOfNeighborNumberIsNeighborIntegerCases++;
	}
	if (s[i] == i) countOfUnmovedNumbers++;
}

for (var i = 0; i < s.length; i++){
	assert(integrityCheckHash[i.toString()], 'Cannot find ' + i + ' in integrityCheckHash');
}

if (yell){
	console.log('Count of neighbor cases: ' + countOfNeighborNumberIsNeighborIntegerCases);
	console.log('Count of unmoved numbers: ' + countOfUnmovedNumbers);
}

assert(countOfNeighborNumberIsNeighborIntegerCases / s.length < .025); //Not tolerating more than 2.5% of "neightbor" cases
assert(countOfUnmovedNumbers / s.length < .025); //Not tolerating more than 2.5% of "unmoved numbers" cases
