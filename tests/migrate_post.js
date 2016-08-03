var fs = require('fs');
var path = require('path');
//Loading Lawncipher next-gen
var Lawncipher = require('../lawncipher.js');
Lawncipher.init();

var assert = require('assert');

var dbPassword = 'dbpasswordwith0entropy';
var dbPath = path.join(__dirname, 'test_migration_v1/test_db');
var db = new Lawncipher.db(dbPath);

var generatedDocIdList;
var generatedDocs;
var generatedBlobs;
var generatedTTLs;

var testDataSetPath = path.join(__dirname, 'test_migration_v1/test_data');
var testDocListPath = path.join(testDataSetPath, 'ids.json');
var testDocsPath = path.join(testDataSetPath, 'docs.json');
var testBlobsPath = path.join(testDataSetPath, 'blobs.json');
var testTTLsPath = path.join(testDataSetPath, 'ttls.json');

function deepObjectEquality(o1, o2){
  if (!(typeof o1 == typeof o2)) return false;
  var paramType = typeof o1;
  if (paramType == 'object'){
    if (Array.isArray(o1) || Array.isArray(o2)){
      if (xor(Array.isArray(o1), Array.isArray(o2))) return false;
      //We assume that both parameters are arrays
      if (o1.length != o2.length) return false;
      for (var i = 0; i < o1.length; i++){
        if (!deepObjectEquality(o1[i], o2[i])) return false;
      }
      return true;
    } else if (o1 instanceof Date || o2 instanceof Date){
      if (xor(o1 instanceof Date, o2 instanceof Date)) return false;
      return o1.getTime() == o2.getTime();
    }

    var o1Keys = Object.keys(o1);
    var o2Keys = Object.keys(o2);
    if (o1Keys.length != o2Keys.length) return false;

    var commonPropertiesNames = 0;
    for (var i = 0; i < o1Keys.length; i++){
      for (var j = 0; j < o2Keys.length; j++){
        if (o1Keys[i] == o2Keys[j]){
          commonPropertiesNames++;
          break;
        }
      }
    }

    if (commonPropertiesNames < o1Keys.length) return false;

    for (var i = 0; i < o1Keys.length; i++){
      if (!deepObjectEquality(o1[o1Keys[i]], o2[o1Keys[i]])) return false;
    }
    return true;
  } else if (paramType == 'function'){
    throw new TypeError('Cannot check equality for functions');
  } else return o1 == o2;
}

function xor(a, b){
  return (a && !b) || (!a && b);
}

function loadTestData(){
  generatedDocIdList = JSON.parse(fs.readFileSync(testDocListPath, 'utf8'));
  generatedDocs = JSON.parse(fs.readFileSync(testDocsPath, 'utf8'));
  generatedBlobs = JSON.parse(fs.readFileSync(testBlobsPath, 'utf8'));
  generatedTTLs = JSON.parse(fs.readFileSync(testTTLsPath, 'utf8'));
}

function serializeDatesInDoc(d){
  for (var k in d){
    if (d[k] instanceof Date) d[k] = d[k].toISOString();
  }
}

function checkChain(collection, next){

  var docIndex = 0;

  function checkOne(){
    var currentDocId = generatedDocIdList[docIndex];
    var currentDoc = generatedDocs[currentDocId],
      currentBlob = generatedBlobs[currentDocId],
      currentTTL = generatedTTLs[currentDocId];

    collection.findOne(currentDocId, function(err, foundDoc){
      if (err) throw err;

      if (!foundDoc){
        if (currentTTL){
          console.log('Missing TTLd doc: ' + currentDocId);
          nextDoc();
          return;
        } else throw new Error('Missing doc: ' + currentDocId);
      }

      serializeDatesInDoc(foundDoc);

      /*if (currentBlob){
        assert(currentBlob == foundDoc);
      } else {
        console.log('Current doc: ' + JSON.stringify(currentDoc, undefined, '\t'));
        console.log('Found doc: ' + JSON.stringify(foundDoc, undefined, '\t'));
      }*/

      assert(deepObjectEquality(foundDoc, currentDoc) || deepObjectEquality(foundDoc, currentBlob), 'Doc found for id ' + currentDocId + ' (' + JSON.stringify(foundDoc) + ')');

      nextDoc();
    });
  }

  function nextDoc(){
    docIndex++;
    if (docIndex == generatedDocIdList.length) next();
    else {
      if (docIndex % 100 == 0) setTimeout(checkOne, 0);
      else checkOne();
    }
  }

  checkOne();

}

console.log('Loading test dataset');
loadTestData();
console.log('Opening DB');
db.openWithPassword(dbPassword, function(err){
  if (err) throw err;

  console.log('Opening collection');
  db.collection('test_collection', function(err, collection){
    if (err) throw err;

    console.log('Checking docs existence');
    checkChain(collection, function(){
        console.log('Closing DB');
        db.close();

        console.log('Re-opening the migrated DB');
        db = new Lawncipher.db(dbPath);
        db.openWithPassword(dbPassword, function(err){
          if (err) throw err;

          db.collection('test_collection', function(err, collection){
            console.log('Checking docs existence');

            checkChain(collection, function(){
              console.log('Migration complete and correct');

              db.close();
            });
          });
        });
    });
  });
});
