var fs = require('fs');
var path = require('path');
var assert = require('assert');
var crypto = require('crypto');
var Buffer = require('buffer').Buffer;
var Lawncipher = require('../');
var Long = require('long');
var libsodium = require('libsodium-wrappers');
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
//The range of the number of conflicting field values in a document
var numberOfConflictingFieldsRange = [1, 3];
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
//The range of the number values
var numberRange = [0, 10000000];
//The range of the date values (in days since 1/1/1970 00:00:00)
var dateRange = [0, 20000];
//The range of the date values (the "clock" part, in milliseconds)
var dateTimeRange = [0, 24 * 3600 * 1000];
//The charset used in the method generateString
var strCharset = 'aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ0123456789'

Lawncipher.init();

var dbPath = path.join(__dirname, 'test_index_model');

var db = new Lawncipher.db(dbPath);

function bufToUI8(b){
  if (!Buffer.isBuffer(b)) throw new TypeError('b must be a buffer');
  var ab = new ArrayBuffer(b.length);
  var ua = new Uint8Array(ab);
  for (var i = 0; i < b.length; i++) ua[i] = b[i];
  return ua;
}

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

    var selectedIdField;
    do {
      selectedIdField = randomSelectionFromArray(validIdFields);
    } while (!(indexModel[selectedIdField].unique));

    indexModel[selectedIdField].id = true;
  }

  return indexModel;
}

function docGeneratorsFactory(indexModel){
  var idField;
  var idValues = {};  //Hash<IdValue, Boolean>
  var idGenerator;
  var uniqueFields = [];
  var idAndUniqueFields;
  var uniqueValues = {}; //Hash<FieldName, Hash<Value, Boolean>>
  var fieldValuesGenerators = {};
  var conflictTypes = ['type_mismatch', 'not_unique'];

  var modelFields = Object.keys(indexModel);
  for (var i = 0; i < modelFields.length; i++){
    fieldValuesGenerators[modelFields[i]] = getGeneratorFor(indexModel[modelFields[i]].type);

    if (indexModel[modelFields[i]].id){
      idField = modelFields[i];
      idGenerator = fieldValuesGenerators[idField];
    } else if (indexModel[modelFields[i]].unique){
      uniqueFields.push(modelFields[i]);
      uniqueValues[modelFields[i]] = {};
    }
  }

  idAndUniqueFields = uniqueFields.slice();
  if (idField) idAndUniqueFields.splice(0, 0, idField); //Add idField to the start of idAndUniqueFields, it if exists

  //Compliant doc generator
  function compliantDoc(){
    var currentDoc = {};
    var currentIdValue;
    var currentUniqueValues = {};

    //Generating compliant doc Id
    if (idField){
      do {
        currentIdValue = idGenerator();
      } while (idValues[currentIdValue]);
      idValues[currentIdValue] = true;
    }

    //Generating compliant unique values
    for (var i = 0; i < uniqueFields.length; i++){
      var currentFieldValue;
      var currentFieldValueStr;
      do {
        currentFieldValue = fieldValuesGenerators[uniqueFields[i]]();
        currentFieldValueStr = stringifyValue(currentFieldValue);
      } while (!uniqueValues[uniqueFields[i]][currentFieldValueStr])

      uniqueValues[uniqueFields[i]][currentFieldValueStr] = true;
      currentUniqueValues[uniqueFields[i]] = currentFieldValueStr;
     }

    for (var i = 0; i < modelFields.length; i++){
      if (idField && idField == modelFields[i]){
        //Current field is id
        currentDoc[modelFields[i]] = currentIdValue;
      } else if (uniqueFields.indexOf(modelFields[i]) != -1){
        //Current field is unique
        currentDoc[modelFields[i]] = currentUniqueValues[modelFields[i]];
      } else {
        //Standard field
        currentDoc[modelFields[i]] = fieldValuesGenerators[modelFields[i]]();
      }
    }

    return currentDoc;
  }

  //Conflicting doc generator
  compliantDoc.conflict = function(){
    var numberOfConflictingFields = generateIntInRange(numberOfConflictingFieldsRange);

    //Starting building the conflicting doc by getting a compliant one, and then changing field values
    var conflictingDoc = compliantDoc();

    //When generating a conflictingDoc, we return the generated doc, but also the offending reasons it will raise when calling isIndexModelCompatible
    var offendingReasons = {};

    //Selecting the names of the fields whose values will become conflicting
    var namesOfConflictingFields = {};
    for (var i = 0; i < numberOfConflictingFields; i++){
      var selectedField;
      do {
        selectedField = randomSelectionFromArray(modelFields);
      } while (namesOfConflictingFields[selectedField]);

      namesOfConflictingFields[selectedField] = true;
    }

    //Transforming the string-set into an array of string
    namesOfConflictingFields = Object.keys(namesOfConflictingFields);

    for (var i = 0; i < namesOfConflictingFields.length; i++){
      var currentConflictField = namesOfConflictingFields[i];
      var currentConflictFieldCanCauseNotUnique = indexModel[currentConflictField].unique || indexModel[currentConflictField].id;
      var currentConflictType = randomSelectionFromArray(currentConflictFieldCanCauseNotUnique ? conflictTypes : conflictTypes.slice().splice(conflictTypes.indexOf('not_unique'), 1));
      if (currentConflictType == 'type_mismatch'){
        //Type mismatches. Select a type that is different from the current one
        var indexedFieldType = indexModel[currentConflictField].type;
        var theOtherTypes = indexableTypesArray.slice();
        var indexedFieldTypePosition = indexableTypesArray.indexOf(indexedFieldType);
        if (indexedFieldTypePosition == -1) continue;
        theOtherTypes.splice(indexedFieldTypePosition, 1);

        var selectedConflictingType = randomSelectionFromArray(theOtherTypes);
        //Generate a value of the new type and assign it the conflicting doc
        var conflictingValue = fieldValuesGenerators[selectedConflictingType]();
        conflictingDoc[currentConflictField] = conflictingValue;
        //Add it as an offending reason for the doc
        addOffendingReason(currentConflictField, 'type_mismatch');
      } else if (currentConflictType == 'not_unique'){
        //Detect whether the current field is id or just unique
        var currentFieldValuesList;
        if (currentConflictField == idField){
          currentFieldValuesList = Object.keys(idValues);
        } else {
          currentFieldValuesList = Object.keys(uniqueValues[currentConflictType]);
        }
        //Randomly select an existing value
        var existingValue = randomSelectionFromArray(currentFieldValuesList);
        //Set it on the conflictingDoc
        conflictingDoc[currentConflictField] = existingValue;
        //Add it as an offending reason for the doc
        addOffendingReason(currentConflictField, 'not_unique');
      } else {
        console.error('Unexpected conflict type: ' + currentConflictType);
      }
    }
  };

  return {
    doc: conflictingDoc,
    offendingReasons: offendingReasons,
  };

  function addOffendingReason(field, reason){
    if (offendingReasons[field]) offendingReasons[field].push(reason);
    else offendingReasons[field] = [reason];
  }
}

function stringGenerator(){
  return generateStringWithinSize(stringSizeRange);
}

function numberGenerator(){
  return generateIntInRange(numberRange);
}

function dateGenerator(){
  return new Date(generateIntInRange(dateRange) * (24 * 3600 * 1000) + generateIntInRange(dateTimeRange));
}

function booleanGenerator(){
  return !!(Math.random() < .5);
}

function bufferGenerator(){
  return bufToUI8(crypto.randomBytes(generateIntInRange(stringSizeRange)));
}

var objectGenerator = faker.helpers.createCard;

function getGeneratorFor(type){
  if (type == 'string'){
    return stringGenerator;
  } else if (type == 'number'){
    return numberGenerator;
  } else if (type == 'date'){
    return dateGenerator;
  } else if (type == 'boolean'){
    return booleanGenerator;
  } else if (type == 'buffer'){
    return bufferGenerator;
  } else if (type == 'object'){
    return objectGenerator;
  } else {
    throw new Error('No generator function for type: ' + type);
  }
}

function stringifyValue(v){
  var tv = typeof v;
  if (tv == 'string') return v;
  else if (tv == 'number' || tv == 'boolean') return v.toString();
  else if (v instanceof Date) return v.getTime().toString();
  else if (v instanceof Uint8Array) return libsodium.to_base64(v);
  else if (tv == 'object') return JSON.stringify(v);
  else throw new TypeError();
}

function generateNewIndexModelFrom(indexModel){
  //Generate an indexModel from an other, for migration testing
}

//Have 2 different index models (at least)
//Generate docs that can go with both models
//Generate some conflicts
