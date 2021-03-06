'use strict';

var fs = require('fs'),
    path = require('path');

var assign = require('lodash/object/assign'),
    pick = require('lodash/object/pick'),
    forEach = require('lodash/collection/forEach');

var ensureOptions = require('./util/ensure-opts');


var ENCODING_UTF8 = 'utf8';
var FILE_PROPERTIES = ['path', 'name', 'contents', 'lastModified', 'fileType'];


/**
 * Interface for handling files.
 *
 * @param  {Object} browserWindow   Main browser window
 */
function FileSystem(options) {
  ensureOptions([ 'dialog' ], options);

  this.dialog = options.dialog;
}

module.exports = FileSystem;


FileSystem.prototype.open = function(callback) {
  var self = this,
      dialog = this.dialog,
      files = [];

  var filenames = dialog.showDialog('open');

  if (!filenames) {
    return callback(null);
  }

  forEach(filenames, function(filename, idx) {
    var file = self._openFile(filename);

    if (!file.contents) {
      callback(file);

      return false;
    }

    files.push(file);
  });

  callback(null, files);
};


FileSystem.prototype._openFile = function(filePath) {
  var diagramFile;

  try {
    diagramFile = this.readFile(filePath);
  } catch (err) {
    return err;
  }

  return diagramFile;
};


FileSystem.prototype.saveAs = function(diagramFile, callback) {
  var dialog = this.dialog,
      filePath,
      actualFilePath,
      savedFile,
      overrideAnswer;

  while (!savedFile) {

    filePath = dialog.showDialog('save', createFileDescriptor({
      name: diagramFile.name,
      fileType: diagramFile.fileType
    }));

    // -> user cancel on save as file chooser
    if (!filePath) {
      break;
    }

    actualFilePath = ensureExtension(filePath, diagramFile.fileType);

    // display an additional override warning if
    // filePath.defaultExtension would override an existing file
    if (filePath !== actualFilePath && existsFile(actualFilePath)) {

      overrideAnswer = dialog.showDialog('existingFile', { name: diagramFile.name });

      // -> user cancel, abort everything
      if (overrideAnswer === 'cancel') {
        break;
      }

      // -> user wants to try again
      if (overrideAnswer === 'no-override') {
        continue;
      }
    }

    // everything ok up to here -> we got a file
    savedFile = createFileDescriptor(diagramFile, {
      path: actualFilePath
    });
  }

  callback(null, savedFile);
};


FileSystem.prototype.save = function(diagramFile, callback) {
  var filePath = diagramFile.path;

  try {
    var newDiagramFile = this.writeFile(filePath, diagramFile);

    callback(null, newDiagramFile);
  } catch (err) {
    callback(err);
  }
};


/**
 * Read a file.
 *
 * @param {String} filePath
 * @param {String} [encoding=utf8]
 *
 * @return {FileDescriptor}
 */
FileSystem.prototype.readFile = function(filePath, encoding) {

  encoding = encoding || ENCODING_UTF8;

  var fileContents = fs.readFileSync(filePath, encoding);

  // TODO(nikku): remove this behavior and move to client
  if (encoding === ENCODING_UTF8) {

    // trim leading and trailing whitespace
    // this fixes obscure import errors for non-strict
    // xml exports
    fileContents = fileContents.replace(/(^\s*|\s*$)/g, '');
  }

  return createFileDescriptor({
    path: filePath,
    contents: fileContents,
    lastModified: getLastModifiedTicks(filePath)
  });
};

/**
 * Return last modified for the given file path.
 *
 * @param {String} path
 *
 * @return {Integer}
 */
FileSystem.prototype.readFileStats = function(file) {
  return createFileDescriptor(file, {
    lastModified: getLastModifiedTicks(file.path)
  });
};



/**
 * Write a file.
 *
 * @param {String} filePath
 * @param {FileDescriptor} file
 *
 * @return {FileDescriptor} written file
 */
FileSystem.prototype.writeFile = function(filePath, file) {
  var contents = file.contents,
      encoding;

  var match = /^data:(image\/[^;]+);base64,(.*)$/.exec(contents);

  if (match) {
    encoding = 'base64';
    contents = match[2];
  } else {
    encoding = ENCODING_UTF8;
  }

  fs.writeFileSync(filePath, contents, encoding);

  return createFileDescriptor(file, {
    lastModified: getLastModifiedTicks(filePath)
  });
};


/**
 * Return last modified for the given file path.
 *
 * @param {String} path
 *
 * @return {Integer}
 */
function getLastModifiedTicks(path) {
  try {
    var stats = fs.statSync(path);
    return stats.mtime.getTime() || 0;
  } catch (err) {
    console.error('Could not get file stats for the path: ' + path);
    return 0;
  }
}


/**
 * Create a file descriptor from optional old file and new file properties.
 * Assures only known properties are used.
 *
 * @param {FileDescriptor} oldFile
 * @param {FileDescriptor} newFile
 *
 * @return {FileDescriptor}
 */
function createFileDescriptor(oldFile, newFile) {
  // no old file supplied
  if (arguments.length == 1) {
    newFile = oldFile;
    oldFile = {};
  } else {
    oldFile = pick(oldFile, FILE_PROPERTIES);
  }

  newFile = pick(newFile, FILE_PROPERTIES);

  if (newFile.path) {
    newFile.name = path.basename(newFile.path);
  }

  return assign({}, oldFile, newFile);
}


/**
 * Check whether a file exists.
 *
 * @param {String} filePath
 *
 * @return {Boolean}
 */
function existsFile(filePath) {
  try {
    fs.statSync(filePath);

    return true;
  } catch (e) {
    return false;
  }
}


/**
 * Ensure that the file path has an extension,
 * defaulting to defaultExtension if non is present.
 *
 * @param {String} filePath
 * @param {String} defaultExtension
 *
 * @return {String} filePath that definitely has an extension
 */
function ensureExtension(filePath, defaultExtension) {
  var extension = path.extname(filePath);

  return extension ? filePath : filePath + '.' + defaultExtension;
}