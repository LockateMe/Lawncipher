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
var testPassword = 'password';
var collectionName = 'test_collection';
//The types' list, that we have to select from for each field added in an index model
var typesArray = ['string', 'number', 'date', 'boolean', 'buffer', 'object'];
//The types that can have their dedicated index
var indexableTypesArray = ['string', 'number', 'date', 'boolean', 'buffer'];
//The types that could be used as a DocId
var idAndUniqueTypesArray = ['string', 'number', 'date', 'buffer'];
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
//The range of the number of fields that are modified in an indexModel change
var migrationModifiedFieldsRange = [0, 2];
//The range of the number of fields that are added in an indexModel change
var migrationAddedFieldsRange = [0, 2];
//The range of the number of fields that are removed in an indexModel change
var migrationRemovedFieldsRange = [0, 2];
//The list of possible field modifications
var migrationFieldModifcations = ['type', 'unique', 'index'];
//The number of allowed modifications, per modified field
var migrationFieldModifcationsCount = [1, 2];
//The range of the number of fields that are "future conflicts" in a doc returned by futureConflict
var futureConflictFieldsCount = [1, 2];
//Max number of tries in the futureConflict method
var futureConflictMaxTries = 50;
//Number of documents in one trial
var numDocs = 1000;
//Number of conflicting documents in one trial
var numConflicts = 50;
//Number of documents that will become conflicts after a first migration
var numFutureConflicts = 50;

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
  if (r[0] == r[1]) return r[0];
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

function generateUniqueArray(generatorFunction, numElements){
  var s = {};
  for (var i = 0; i < numElements; i++){
    var currentElement;
    do {
      currentElement = stringifyValue(generatorFunction());
    } while (s[currentElement]);
    s[currentElement] = true;
  }

  return Object.keys(s);
}

function generateUniqueArrayFromArray(a, numElements){
  return generateUniqueArray(function(){
    return randomSelectionFromArray(a);
  }, Math.min(numElements, a.length));
}

function randomSelectionFromArray(a){
  return a[Math.floor(Math.random() * a.length)];
}

function isInArray(array, value){
  return array.indexOf(value) != -1
}

function checkStringArrayEquality(a1, a2){
  if (!(Array.isArray(a1) && Array.isArray(a2))) throw new TypeError('both a1 and a2 must be arrays');
  if (a1.length != a2.length) throw new TypeError('a1 and a2 must have the same length');

  var l = a1.length;
  for (var i = 0; i < l; i++){
    var found = false;
    for (var j = 0; j < l; j++){
      if (a1[i] == a2[j]){
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  return true;
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
    //Check unique, if the type is compatible
    if (idAndUniqueTypesArray.indexOf(currentFieldType) != -1 && Math.random() < uniqueProbability){
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
      if (idAndUniqueTypesArray.indexOf(currentModelFields[i]) != -1){
        validIdFields.push(currentModelFields[i]);
      }
    }

    if (validIdFields.length == 0){
      //We want to generate an index model with an id field. Cut and restart generation
      return generateIndexModel();
    }

    var selectedIdField;
    do {
      selectedIdField = randomSelectionFromArray(validIdFields);
    } while (!(indexModel[selectedIdField].unique));

    indexModel[selectedIdField].id = true;
  }

  return typeof Lawncipher.validateIndexModel(indexModel) != 'string' ? indexModel : generateIndexModel();
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
      //console.log('Generating idValue');
      do {
        currentIdValue = idGenerator();
      } while (idValues[stringifyValue(currentIdValue)]);
      idValues[currentIdValue] = true;
    }

    //Generating compliant unique values
    //console.log('Generating the values of "unique" fields');
    for (var i = 0; i < uniqueFields.length; i++){
      var currentFieldValue;
      var currentFieldValueStr;
      do {
        currentFieldValue = fieldValuesGenerators[uniqueFields[i]]();
        currentFieldValueStr = stringifyValue(currentFieldValue);
      } while (uniqueValues[uniqueFields[i]][currentFieldValueStr]);

      uniqueValues[uniqueFields[i]][currentFieldValueStr] = true;
      currentUniqueValues[uniqueFields[i]] = currentFieldValue;
    }

    //console.log('Generating the values for the remaining fields');
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

    //console.log('Choosing the names of the fields that will be conflicting');
    //Selecting the names of the fields whose values will become conflicting
    var namesOfConflictingFields = generateUniqueArrayFromArray(modelFields, numberOfConflictingFields);
    //console.log('namesOfConflictingFields: ' + JSON.stringify(namesOfConflictingFields));

    for (var i = 0; i < namesOfConflictingFields.length; i++){
      var currentConflictField = namesOfConflictingFields[i];
      var currentConflictFieldCanCauseNotUnique = indexModel[currentConflictField].unique || indexModel[currentConflictField].id;
      var currentConflictType = randomSelectionFromArray(currentConflictFieldCanCauseNotUnique ? conflictTypes : conflictTypes.slice().splice(conflictTypes.indexOf('not_unique'), 1));
      //console.log('---------------------');
      //console.log('currentConflictField: ' + currentConflictField);
      //console.log('currentConflictType: ' + currentConflictType);
      if (currentConflictType == 'type_mismatch'){
        //Type mismatches. Select a type that is different from the current one
        var indexedFieldType = indexModel[currentConflictField].type;
        //console.log('indexedFieldType: ' + indexedFieldType);
        var theOtherTypes = indexableTypesArray.slice();
        var indexedFieldTypePosition = indexableTypesArray.indexOf(indexedFieldType);
        if (indexedFieldTypePosition == -1) continue;
        theOtherTypes.splice(indexedFieldTypePosition, 1);
        //console.log('theOtherTypes: ' + JSON.stringify(theOtherTypes));

        var selectedConflictingType;
        var selectedConflictingTypeTrials = 0;
        var hasCastingMethod;
        do {
          selectedConflictingType = randomSelectionFromArray(theOtherTypes);
          selectedConflictingTypeTrials++;
          //(Check whether we can convert selectedConflictingType to indexedFieldType)
          hasCastingMethod = Lawncipher.isCastable(selectedConflictingType, indexedFieldType);
        } while (hasCastingMethod && selectedConflictingTypeTrials <= 5);

        //console.log('selectedConflictingType: ' + selectedConflictingType);
        //Generate a value of the new type and assign it the conflicting doc
        var conflictingValue = getGeneratorFor(selectedConflictingType)();
        conflictingDoc[currentConflictField] = conflictingValue;
        //Add it as an offending reason for the doc, if the new field value is not castable
        if (!hasCastingMethod){
          addOffendingReason(currentConflictField, 'type_mismatch');
        }
      } else if (currentConflictType == 'not_unique'){
        //Detect whether the current field is id or just unique
        var currentFieldValuesList;
        if (currentConflictField == idField){
          currentFieldValuesList = Object.keys(idValues);
        } else {
          currentFieldValuesList = (uniqueValues[currentConflictField] && Object.keys(uniqueValues[currentConflictField])) || [];
        }
        if (currentFieldValuesList.length == 0) continue;
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

    return {
      doc: conflictingDoc,
      offendingReasons: offendingReasons,
    };

    function addOffendingReason(field, reason){
      if (offendingReasons[field]) offendingReasons[field].push(reason);
      else offendingReasons[field] = [reason];
    }
  };

  //This a "more than brute-force" test
  compliantDoc.futureConflict = function(conflictWithIndexModel){
    var indexValidationResult = Lawncipher.validateIndexModel(conflictWithIndexModel, true);
    if (typeof indexValidationResult != 'object') throw new Error(indexValidationResult);

    var indexModelSummary = indexValidationResult;

    var numTries = 0;
    var futureDoc = compliantDoc();
    /*do {
      futureDoc = compliantDoc();
      numTries++;
    } while (!(typeof Lawncipher.validateIndexAgainstModel(futureDoc, conflictWithIndexModel) == 'string' || numTries > futureConflictMaxTries));

    if (numTries > futureConflictMaxTries){
      console.log('Retry');
      return compliantDoc.futureConflict(conflictWithIndexModel);
    }*/

    var offendingReasons = {};
    var newModelFields = Object.keys(conflictWithIndexModel);

    console.log('Trying to validate the randomly generated & unmodified futureDoc');
    var typeMismatches = [];
    var currentDoc = futureDoc
    var validationResult = Lawncipher.validateIndexAgainstModel(currentDoc, conflictWithIndexModel);
    var hadToBeCloned = false;
    while (typeof validationResult == 'string'){
      if (typeMismatches.length == 0){
        currentDoc = Lawncipher.clone(currentDoc);
        hadToBeCloned = true;
      }
      delete currentDoc[validationResult];
      typeMismatches.push(validationResult);

      validationResult = Lawncipher.validateIndexAgainstModel(currentDoc, conflictWithIndexModel);
    }

    console.log('Type mismatches: ' + JSON.stringify(typeMismatches));

    if (hadToBeCloned) currentDoc = futureDoc;

    for (var i = 0; i < typeMismatches.length; i++){
      addOffendingReason(typeMismatches[i], 'type_mismatch');
    }

    var newIdAndUniqueFields = indexModelSummary.idAndUniqueFields;
    for (var i = 0; i < newIdAndUniqueFields.length; i++){
      if (newIdAndUniqueFields[i] == indexModelSummary.id){
        //Current field is the id field. Check whether this futureDoc has a "not_unique" conflict or not
        var currentFieldValue = futureDoc[idField];
        var currentFieldValueStr = stringifyValue(currentFieldValue);
        if (idValues[currentFieldValueStr]){
          addOffendingReason(idField, 'not_unique');
        } else {
          idValues[currentFieldValueStr] = true;
        }
      } else if (newIdAndUniqueFields[i]){
        //Current field is flagger as "unique". Check whether the value of this current field is a "not_unique" conflict or not
        var currentFieldValue = futureDoc[newIdAndUniqueFields[i]];
        var currentFieldValueStr = stringifyValue(currentFieldValue);
        if (uniqueValues[newIdAndUniqueFields[i]] && [newIdAndUniqueFields[i]][currentFieldValueStr]){
          addOffendingReason(newIdAndUniqueFields[i], 'not_unique');
        } else {
          if (!uniqueValues[newIdAndUniqueFields[i]]) uniqueValues[newIdAndUniqueFields[i]] = {};
          uniqueValues[newIdAndUniqueFields[i]][currentFieldValueStr] = true;
        }
      }
    }

    return {
      doc: futureDoc,
      offendingReasons: offendingReasons,
    };

    function addOffendingReason(field, reason){
      if (offendingReasons[field]) offendingReasons[field].push(reason);
      else offendingReasons[field] = [reason];
    }
  };

  compliantDoc.removeFromIndex = function(doc){
    //For the given doc, remove from idValues and uniqueValues
    if (idField && typeof doc[idField] != 'undefined'){
      delete idValues[doc[idField]];
    }

    for (var i = 0; i < uniqueFields.length; i++){
      if (typeof doc[uniqueFields[i]]) continue;

      var currentUniqueFieldValue = doc[uniqueFields[i]];
      var currentUniqueFieldValueStr = stringifyValue(currentUniqueFieldValue);
      if (uniqueValues[uniqueFields[i]][currentUniqueFieldValueStr]){
        delete uniqueValues[uniqueFields[i]][currentUniqueFieldValueStr]
      }
    }
  };

  return compliantDoc;
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
  else {
    console.log(v);
    console.log(JSON.stringify(v));
    throw new TypeError('Cannot stringifyValue() of type ' + tv);
  }
}

function generateNewIndexModelFrom(_indexModel){
  if (typeof _indexModel != 'object') throw new TypeError();
  //Cloning the indexModel, for immutability of the indexModel parameter
  var indexModel = Lawncipher.clone(_indexModel);
  var currentFieldsList = Object.keys(indexModel);
  //Generate an indexModel from an other, for migration testing
  var modifiedFieldsCount = generateIntInRange(migrationModifiedFieldsRange);
  var addedFieldsCount = generateIntInRange(migrationAddedFieldsRange);
  var removedFieldsCount = generateIntInRange(migrationRemovedFieldsRange);

  var idField;
  for (var i = 0; i < currentFieldsList.length; i++){
    if (indexModel[currentFieldsList[i]].index){
      idField = currentFieldsList[i];
      break;
    }
  }

  /*
  * First remove the fields
  */
  console.log('Choosing the fields to be removed')
  var fieldsToBeRemoved = generateUniqueArrayFromArray(currentFieldsList, removedFieldsCount);

  for (var i = 0; i < fieldsToBeRemoved.length; i++){
    if (idField == fieldsToBeRemoved[i]) idField = null;
    delete indexModel[fieldsToBeRemoved[i]];
    currentFieldsList.splice(currentFieldsList.indexOf(fieldsToBeRemoved[i]), 1);
  }
  /*
  * Then modify the fields
  */
  console.log('Choosing the fields to be modified');
  var fieldsToBeModified = generateUniqueArrayFromArray(currentFieldsList, modifiedFieldsCount);

  //For each field that will be modified
  for (var i = 0; i < fieldsToBeModified.length; i++){
    var currentField = fieldsToBeModified[i];
    console.log('Current field to be modified: ' + currentField);
    var currentFieldDescription = indexModel[currentField];
    var numberOfModifications = generateIntInRange(migrationFieldModifcationsCount);
    //currentModificationTypes contains the types of modifications for that are allowed on the current field, given its current settings.
    //'index' is removed from currentModificationTypes if the current type of the field is not indexable
    var currentModificationTypes = (indexableTypesArray.indexOf(currentFieldDescription.type) != -1) ? migrationFieldModifcations : migrationFieldModifcations.slice().splice(migrationFieldModifcations.indexOf('index'), 1);
    console.log('Choosing field modifications');
    var fieldModifications = generateUniqueArrayFromArray(currentModificationTypes, numberOfModifications);
    console.log('Field modifications have been chosen');

    for (var j = 0; j < fieldModifications.length; j++){
      console.log('Current field modification: ' + fieldModifications[i]);
      if (fieldModifications[j] == 'type'){
        var otherTypes = typesArray.slice().splice(typesArray.indexOf(currentFieldDescription.type), 1);
        var newType = randomSelectionFromArray(otherTypes);
        currentFieldDescription.type = newType;
      } else if (fieldModifications[j] == 'unique'){
        //check idAndUniqueTypesArray here
        currentFieldDescription.unique = typeof currentFieldDescription.unique == 'boolean' ? !currentFieldDescription.unique : booleanGenerator(); //Negate currentFieldDescription.unique if it exists
      } else if (fieldModifications[j] == 'index'){
        //check idAndUniqueTypesArray here
        currentFieldDescription.index = typeof currentFieldDescription.index == 'boolean' ? !currentFieldDescription.index : booleanGenerator();
      } else throw new Error('Unexpected field modification type: ' + fieldModifications[j]);
    }
  }
  /*
  * Then add the new fields
  */
  //For each field to be added, generate a unique name (that does not already exist in indexModel)
  console.log('Choosing the fields to be added');
  var fieldsToBeAdded = {};
  for (var i = 0; i < addedFieldsCount; i++){
    var currentFieldName;
    do {
      currentFieldName = generateStringWithinSize(fieldNameSizeRange);
    } while (fieldsToBeAdded[currentFieldName] || indexModel[currentFieldName]);
    fieldsToBeAdded[currentFieldName] = true;
  }

  fieldsToBeAdded = Object.keys(fieldsToBeAdded);

  for (var i = 0; i < fieldsToBeAdded.length; i++){
    //Generate the field's description
    var currentField = fieldsToBeAdded[i];
    var currentFieldType = randomSelectionFromArray(typesArray);
    var currentFieldDescription = {type: currentFieldType};
    //Check indexable
    var isIndexable = isInArray(typesArray, currentFieldType);
    if (isInArray && Math.random() <= indexedProbability){
      currentFieldDescription.index = true;
    }
    //Check unique
    if (Math.random() < uniqueProbability){
      currentFieldDescription.unique = true;
    }

    indexModel[currentField] = currentFieldDescription;
  }

  //Return the resulting indexModel
  if (typeof Lawncipher.validateIndexModel(indexModel) != 'string'){
    console.log('The model is valid; returning');
    return indexModel;
  } else {
    console.log('The model is not valid, generating a new one');
    return generateNewIndexModelFrom(_indexModel);
  }
  //return typeof Lawncipher.validateIndexModel(indexModel) != 'string' ? indexModel : generateNewIndexModelFrom(_indexModel);
}

function initTests(cb){
  if (typeof cb != 'function') throw new TypeError('cb must be a function');

  console.log('Initializing DB with test password');
  db.openWithPassword(testPassword, function(err){
    if (err) throw err;

    cb();
  });
}

function oneTest(cb){
  if (cb && typeof cb != 'function') throw new TypeError('when defined, cb must be a function');

  console.log('oneTest call');
  console.log('Generating an index model');
  var initialModel = generateIndexModel();
  console.log('Generated index model:\n' + JSON.stringify(initialModel, undefined, '\t'));

  console.log('Instanciating the docGenerator');
  var docGenerator = docGeneratorsFactory(initialModel);

  var docsIDs, futureConflictsIDs;

  console.log('Generating the test (complying) documents');
  var docs = new Array(numDocs);
  for (var i = 0; i < numDocs; i++){
    docs[i] = docGenerator();
  }

  console.log('Generating the conflicting documents');
  var conflicts = new Array(numConflicts);
  for (var i = 0; i < numConflicts; i++){
    conflicts[i] = docGenerator.conflict();
  }

  /*console.log('Generating the indexModel we are going to migrate to');
  var futureModel = generateNewIndexModelFrom(initialModel);
  console.log('Index model we will migrate to: ' + JSON.stringify(futureModel, undefined, '\t'));
  console.log('Generating future conflicts (i.e, docs that are valid with the current model, but that will be invalid once we change IndexModels)');
  var futureConflicts = new Array(numFutureConflicts);
  for (var i = 0; i < numFutureConflicts; i++){
    futureConflicts[i] = docGenerator.futureConflict(futureModel);
    console.log('Properties of futureConflicts[' + i + ']: ' + JSON.stringify(Object.keys(futureConflicts[i])));
  }*/

  console.log('Instanciating the collection with the index model');
  db.collection(collectionName, function(err, col){
    if (err) throw err;

    console.log('Inserting the complying documents');
    col.bulkSave(docs, function(err, _docIDs){
      if (err){
        if (typeof err == 'string'){
          var errDocIndexMatch = /^\[(\d+)\]/.exec(err);
          var errDocIndex = errDocIndexMatch[1];
          if (errDocIndex){
            errDocIndex = parseInt(errDocIndex);
            if (!isNaN(errDocIndex)){
              var errDoc = docs[errDocIndex];
              console.error('Doc causing the error:\n' + JSON.stringify(errDoc, undefined, '\t'));
            }
          }
        }
        throw err;
      }

      docIDs = _docIDs;

      /*setTimeout(function(){
        console.log('Running the conflicting insertions');
        doConflicts(col, function(){
          console.log('Running the future conflicts test (doc insertion followed by failing IndexModel migration)');
          doFutureConflicts(col, function(){
            if (cb) cb();
          });
        });
      }, 2500);*/

      console.log('Running the conflicting insertions');
      setTimeout(function(){
        doConflicts(col, function(){
          col.close();
          if (cb) cb();
          /*console.log('Running the future conflicts test (doc insertion followed by failing IndexModel migration)');
          doFutureConflicts(col, function(){
            if (cb) cb();
          });*/
        });
      }, 0);
    });
  }, initialModel);

  function doConflicts(col, next){
    if (!col) throw new Error('col must be defined');
    if (next && typeof next != 'function') throw new TypeError('when defined, next must be a function');

    var conflictIndex = 0;

    function oneConflict(){
      var currentConflict = conflicts[conflictIndex];
      console.log('Expected offendingReasons: ' + JSON.stringify(currentConflict.offendingReasons));
      col.save(currentConflict.doc, function(err){
        if (!err && Object.keys(currentConflict.offendingReasons).length > 0) throw new Error('The conflicting document ' + JSON.stringify(currentConflict.doc) + ' has been saved, while offendingReasons is not empty');

        console.log('Error thrown by conflicting document ' + conflictIndex + ' : ' + err);

        nextConflict();
      });
    }

    function nextConflict(){
      conflictIndex++;
      if (conflictIndex == conflicts.length){
        if (next) next();
      } else {
        oneConflict();
      }
    }

    oneConflict();
  }

  function doFutureConflicts(col, next){
    if (!col) throw new Error('col must be defined');
    if (next && typeof next != 'function') throw new TypeError('when defined, next must be a function');

    //Mass doc insertion
    col.bulkSave(futureConflicts.map(function(i){return i.doc}), function(err, _futureConflictsIDs){
      if (err) throw err;

      console.log('futureConflictsIDs:\n' + JSON.stringify(_futureConflictsIDs));
      futureConflictsIDs = _futureConflictsIDs;

      col.setIndexModel(futureModel, function(err, offendingDocs){
        if (err) throw err;

        assert(Lawncipher.deepObjectEquality(col.getIndexModel(), futureModel));

        //Check that the offending docs are as expected
        if (!offendingDocs) throw new Error('No offending docs were found in "doFutureConflicts" on setIndexModel');

        var offendingDocsCount = Object.keys(offendingDocs);
        assert(offendingDocsCount == futureConflicts.length, 'Unexpected offendingDocs count for future conflicts: ' + offendingDocsCount);

        for (var i = 0; i < futureConflicts.length; i++){
          var currentDocId = futureConflictsIDs[i];
          var expectedOffendingReasons = futureConflicts[i].offendingReasons;
          var actualOffendingReasons = offendingDocs[currentDocId];

          var expectedOffendingReasonsFieldsList = Object.keys(expectedOffendingReasons);
          var actualOffendingReasonsFieldsList = Object.keys(actualOffendingReasons);

          assert(checkStringArrayEquality(expectedOffendingReasonsFieldsList, actualOffendingReasonsFieldsList), 'Expected and actual offending fields list differ for document ' + i);
          for (var j = 0; j < expectedOffendingReasonsFieldsList.length; j++){
            assert(
              !checkStringArrayEquality(expectedOffendingReasons[expectedOffendingReasonsFieldsList[j]], actualOffendingReasons[expectedOffendingReasons[j]]),
              'Expected and actual offending reasons for field ' + expectedOffendingReasonsFieldsList[j] + ' for doc ' + i + ' differ. (actual: ' + JSON.stringify(actualOffendingReasons[expectedOffendingReasonsFieldsList[i]]) + ', expected: ' + JSON.stringify(expectedOffendingReasons[expectedOffendingReasonsFieldsList[i]]) + ')'
            );
          }
        }
      });
    });

    var futureConflictIndex = 0;
  }
}

function runTests(){
  initTests(function(){
    oneTest(function(){
      db.close();
      console.log('oneTest completed');
    });
  });
}

fs.access(dbPath, function(err){
  if (err){
    //Folder do not exist, most probably -> runTests
    runTests();
  } else {
    rmdir(dbPath, function(err){
      if (err) throw err;

      runTests();
    });
  }
});

//Have 2 different index models (at least)
//Generate docs that can go with both models
//Generate some conflicts
