# Document/index model (`indexModel`):

A schema, called "Index model", can be set for the `indexData` in a given collection. As a reminder, the `indexData` of a document is its "searchable" part. This schema gives the list and type of attributes that will be stored in the index. It can also determine whether a given attribute gives the IDs to the documents of the collection; as well as whether the value of a given attribute must be unique across the collection (without giving document IDs).

You have 2 possible ways to describe your `indexModel`:
* You provide an object describing field to be extracted/provided by the user, to be inserted in the index file of the collection. You can define which field values must be unique (across the collection), which one will be chosen as docId, and which ones have their own search index.
* You provide an array of strings, where each string is a field name. Each field will be extracted from the document on insertion. Note that with this method, you cannot choose which field must have unique values nor can you set the document ID (a random one will be generated)

The "object" way is obviously more complete and versatile.

Here is an `indexModel` object:

```
{
	fieldName: {type: 'typeName', unique: true||false, id: true||false, index: true||false},
	...
}
```

Each indexed field has a description. Here are some details about that description
* In an indexModel, you can only set one field as `id`. If you transgress this rule, the collection construction will return an error
* `type` must be equal to one of the following : `string`, `date`, `number`, `boolean`, `object`, `array`, `buffer`, `*`
* `unique` and `id` parameters are optional. If not defined, they are then assumed as `false`
* If you do not need to set more than the `type` in a field's description, then you can replace `yourFieldName: {type: "yourSelectedType"}` by `yourFieldName: "yourSelectedType"`
* a field marked as `id: true` is also implicitly `unique: true`
* a field marked as `id: true` must be of type 'string' or 'number'
* a field marked as `index: true` will have its dedicated search index
* a field marked as `index: true` must be of one of the following types: `string`, `buffer`, `number`, `date`, `boolean`
* if a field is marked as `id` or `unique`, no document can have a null/undefined value for that field

## A commented indexModel example

```js
{
  id: {type: 'string', id: true}, //The field `id` is a string and is the field that determines a document's identifier
  firstName: 'string', //The field `firstName` is a string
  lastName: {type: 'string', index: true}, //The field `lastName` is a string, and it has a dedicated search index
  isFriend: 'boolean', //The field `isFriend` is a boolean
  creationOrder: {type: 'number', unique: true, index: true}, //The field `creationOrder` is a number. Its values must be unique across the collection. It has its own search index
  creationDate: 'date', //The field `creationDate` is a date
  messages: 'array', //The field `messages` is an arbitrary array
  status: 'object', //The field `status` is an arbitrary object
  notes: '*' //The field `notes` accepts values of any of the supported types
}
```

## Useless trivia
The `indexModel` syntax was originally inspired by  [mongoose's](https://github.com/Automattic/mongoose) [Schema syntax](http://mongoosejs.com/docs/guide.html).
