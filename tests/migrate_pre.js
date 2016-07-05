var fs = require('fs');
var path = require('path');
//Loading Lawncipher v1
var Lawncipher = require('./test_migration_v1/lawncipher_v1/lawncipher.js');

var faker = require('faker');
var mkdirp = require('mkdirp');

var dbPassword = 'dbpasswordwith0entropy';
var dbPath = path.join(__dirname, 'test_migration_v1/test_db');
var db = new Lawncipher.db(dbPath);

var nTestDocs = 100;
var blobProb = 0.1;
var ttlProb = 0.2;

var strCharset = 'aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ0123456789';

function randomString(length){
  var s = '';
  for (var i = 0; i < length; i++) s += strCharset[Math.floor(Math.random() * strCharset.length)];
  return s;
}

var testIndexModel = {
  firstName: 'string',
  lastName: 'string',
  isFriend: 'boolean',
  id: {type: 'string', id: true},
  creationOrder: {type: 'number', unique: true},
  creationDate: 'date',
  messages: 'array',
  status: 'object',
  notes: '*'
};

var generatedDocIdList = [];
var generatedDocs = {};
var generatedBlobs = {};
var generatedTTLs = {};

var testDataSetPath = path.join(__dirname, 'test_migration_v1/test_data');
var testDocListPath = path.join(testDataSetPath, 'ids.json');
var testDocsPath = path.join(testDataSetPath, 'docs.json');
var testBlobsPath = path.join(testDataSetPath, 'blobs.json');
var testTTLsPath = path.join(testDataSetPath, 'ttls.json');

function generateTestDoc(){
  return {
    firstName: faker.name.firstName(),
    lastName: faker.name.lastName(),
    isFriend: faker.random.boolean(),
    id: faker.random.uuid(),
    creationOrder: faker.random.number(),
    creationDate: faker.date.past(),
    messages: (function(){var a = []; var n = faker.random.number({max: 5}); for (var i = 0; i < n; i++) a.push(faker.lorem.sentence()); return a;})()
  };
}

function generateTestBlob(){
  if (Math.random() < blobProb) return randomString(faker.random.number());
}

function generateTestTTL(){
  if (Math.random() < ttlProb) return faker.date.future();
}

function insertChain(collection, next){

  var insertCount = 0;

  function insertOne(){
    var _doc = generateTestDoc();
    var _blob = generateTestBlob();
    var _ttl = generateTestTTL();

    collection.save(_blob, _doc, function(err, docId){
      if (err) throw err;

      generatedDocIdList.push(docId);
      generatedDocs[docId] = _doc;
      if (_blob) generatedBlobs[docId] = _blob;
      if (_ttl) generatedTTLs[docId] = _ttl;

      nextInsert();
    }, false, _ttl);
  }

  function nextInsert(){
    insertCount++;
    if (insertCount == nTestDocs) next();
    else {
      if (insertCount % 100 == 0) setTimeout(insertOne, 0);
      else insertOne();
    }
  }

  insertOne();

}

function saveTestData(cb){
  mkdirp(testDataSetPath, function(err){
    if (err) throw err;

    fs.writeFileSync(testDocListPath, JSON.stringify(generatedDocIdList));
    fs.writeFileSync(testDocsPath, JSON.stringify(generatedDocs));
    fs.writeFileSync(testBlobsPath, JSON.stringify(generatedBlobs));
    fs.writeFileSync(testTTLsPath, JSON.stringify(generatedTTLs));

    if (typeof cb === 'function') cb();
  });
}

console.log('Opening DB');
db.openWithPassword(dbPassword, function(err){
  if (err) throw err;

  console.log('Opening collection');
  db.collection('test_collection', function(err, theCollection){
    if (err) throw err;

    console.log('Inserting documents');
    insertChain(theCollection, function(){
      console.log('Saving the docs in external files');
      saveTestData(function(){
        console.log('Pre-migration complete');
        db.close();
      });
    });
  }, testIndexModel);
});
