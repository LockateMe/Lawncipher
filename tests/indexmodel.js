var fs = require('fs');
var path = require('path');
var assert = require('assert');
var crypto = require('crypto');
var Lawncipher = require('../');
var Long = require('long');
var faker = require('faker');
var rmdir = require('rmdir');

/*
* Some "constants"
*/
//The types' list, that we have to select from for each field added in an index model
var typesArray = ['string', 'number', 'date', 'boolean', 'buffer', 'object'];
//The types that can have their dedicated index
var indexableTypesArray = ['string', 'number', 'date', 'boolean'];
//The range of the number of fields in an index model
var numberOfFieldsRange = [5, 10];
//The probability that an 'id' field will be set in a model
var idFieldProbability = .6;
//The probability that an indexable type is indexed
var indexedProbability = .4;
//The probability that a field must have unique values across the collection
var uniqueProbability = .3;
//The range of the size of a field's name
var fieldNameSizeRange = [2, 8];
//The range of the size of a string field value
var stringSizeRange = [5, 50];
//The charset used in the method generateString
var strCharset = 'aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ0123456789'

Lawncipher.init();

var dbPath = path.join(__dirname, 'test_index_model');

var db = new Lawncipher.db(dbPath);

function generateIntInRange(r){
  return r[0] + Math.round(Math.random() * (r[1] - r[0]));
}

function generateString(length){
  var s = '';
  for (var i = 0; i < length; i++) s += strCharset[Math.floor(Math.random() * strCharset.length)];
  return s;
}

function generateStringWithinSize(r){
  return generateString(generateIntInRange(r));
}

function randomSelectionFromArray(a){
  return a[Math.floor(Math.random() * a.length)];
}

function isInArray(array, value){
  return array.indexOf(value) != -1
}

function generateIndexModel(){
  var numberOfFields = generateIntInRange(numberOfFieldsRange);

  var indexModel = {};
  for (var i = 0; i < numberOfFields; i++){
    var currentFieldName = generateStringWithinSize(fieldNameSizeRange);
    var currentFieldType = randomSelectionFromArray(typesArray);
    var currentFieldDescription = {type: currentFieldType};
    //Check indexable
    var isIndexable = isInArray(typesArray, currentFieldType);
    if (isIndexable && Math.random() <= indexedProbability){
      currentFieldDescription.index = true;
    }
    //Check unique
    if (Math.random() < uniqueProbability){
      currentFieldDescription.unique = true;
    }

    indexModel[currentFieldName] = currentFieldDescription;
  }

  //Set id rand() < p
  var setIdField = Math.random() < idFieldProbability;
  if (setIdField){
    var currentModelFields = Object.keys(indexModel);
    var validIdFields = [];
    for (var i = 0; i < currentModelFields.length; i++){
      if (currentModelFields[i] == 'string' || currentModelFields[i] == 'number'){
        validIdFields.push(currentModelFields[i]);
      }
    }

    var selectedIdField = randomSelectionFromArray(validIdFields);
    indexModel[selectedIdField].id = true;
  }

  return indexModel;
}

function generateDoc(indexModel){
  var d = {};
}

function generateConflictingDoc(indexModel){
  var d = {};
}

//Have 2 different index models (at least)
//Generate docs that can go with both models
//Generate some conflicts
