var Client = require('node-rest-client').Client;
var colors = require('colors');
var _ = require('underscore');
var fs = require('fs');
var dir = require('node-dir');
var archiver = require('archiver');
var request = require('request');
var CLITable = require('cli-table');
var Table = require('easy-table');
var context = require('./context.js');
var login = require('../util/login.js');
var printObject = require('../util/printObject.js');
var dotfile = require('../util/dotfile.js');
//ZIP Support for 4.1
var AdmZip = require('adm-zip');
var filesToSkip = ["__MACOSX", ".DS_Store", ".git", ".gitignore", ".idea"];


module.exports = {
	doAPI: function (action, cmd) {
		if (action === 'list') {
			module.exports.list(cmd);
		}
		else if (action === 'create') {
			module.exports.create(cmd);
		}
		else if (action === 'update') {
			module.exports.update(cmd);
		}
		else if (action === 'delete') {
			module.exports.del(cmd);
		}
		else if (action === 'use') {
			module.exports.use(cmd);
		}
		else if (action === 'import') {
			module.exports.import(cmd);
		}
		else if (action === 'export') {
			module.exports.exportToFile(cmd);
		}
		else if (action === 'extract') {
			module.exports.extract(cmd);
		}
		else {
			console.log('You must specify an API action: list, create, update, delete, use, import, export or extract');
			//program.help();
		}
	},

	list: function (cmd) {
		var client = new Client();

		var loginInfo = login.login(cmd);
		if (!loginInfo)
			return;
		var url = loginInfo.url;
		var apiKey = loginInfo.apiKey;

		client.get(url + "/projects" + "?pagesize=100", {
			headers: {
				Authorization: "CALiveAPICreator " + apiKey + ":1",
				"Content-Type": "application/json"
			}
		}, function (data) {
			if (data.errorMessage) {
				console.log(data.errorMessage.red);
				return;
			}
			printObject.printHeader("All APIs");
			var table = new Table();
			var verboseDisplay = "";
			_.each(data, function (p) {
				table.cell("Ident", p.ident);
				table.cell("Name", p.name);
				table.cell("Enabled", p.is_active);
				table.cell("URL Name", p.url_name);
				var comments = p.comments;
				if (!comments) {
					comments = "";
				}
				else if (comments.length > 50) {
					comments = comments.substring(0, 47) + "...";
				}
				comments = comments.replace("\n", " ");
				comments = comments.replace("\n", " ");
				table.cell("Comments", comments);
				table.newRow();
				if (cmd.verbose) {
					verboseDisplay += "\n";
					verboseDisplay += "lacadmin api export --url_name " + p.url_name + "  --file API_" + p.url_name + ".json --format json\n";
					verboseDisplay += "#lacadmin api export --url_name " + p.url_name + "  --file API_" + p.url_name + ".zip --format zip\n";
					verboseDisplay += "#lacadmin api extract --file API_" + p.url_name + ".zip --directory /temp/ --synchronize true\n";
					verboseDisplay += "#lacadmin api import --file API_" + p.url_name + ".json\n";
					verboseDisplay += "#lacadmin api import --file API_" + p.url_name + ".zip\n";
					//verboseDisplay += "#lacadmin api import --directory /temp/ \n";
				}
			});
			table.sort(['Name']);
			console.log(table.toString());
			printObject.printTrailer("# API: " + data.length);
			if (cmd.verbose) {
				console.log(verboseDisplay);
			}
		});
	},

	create: function (cmd) {
		var client = new Client();
		var loginInfo = login.login(cmd);
		if (!loginInfo)
			return;
		if (!cmd.api_name) {
			console.log('Missing parameter: api_name'.red);
			return;
		}
		if (!cmd.url_name) {
			console.log('Missing parameter: url_name'.red);
			return;
		}
		if (!cmd.authprovider) {
			console.log('You did not specify an authentication provider -- you will not be able to log into this project until you do so.'.yellow);
		}
		context.getContext(cmd, function () {
			//console.log('Current account: ' + JSON.stringify(context.account));

			var newProject = {
				name: cmd.api_name,
				url_name: cmd.url_name,
				is_active: true,
				authprovider_ident: cmd.authprovider || 1000,
				account_ident: context.account.ident,
				comments: cmd.comments
			};

			if (cmd.status) {
				if (cmd.status !== 'A' && cmd.status !== 'I') {
					console.log('Project status must be either A (for active) or I (for inactive). Default is A if unspecified.'.red);
					return;
				}
				newProject.status = cmd.status;
			}

			var startTime = new Date();
			client.post(loginInfo.url + "/projects", {
				data: newProject,
				headers: {
					Authorization: "CALiveAPICreator " + loginInfo.apiKey + ":1",
					"Content-Type": "application/json"
				}
			}, function (data) {
				var endTime = new Date();
				if (data.errorMessage) {
					console.log(data.errorMessage.red);
					return;
				}
				printObject.printHeader('Project was created, including:');
				var newProj = _.find(data.txsummary, function (p) {
					return p['@metadata'].resource === 'admin:projects';
				});
				if (!newProj) {
					console.log('ERROR: unable to find newly created project'.red);
					return;
				}
				if (cmd.verbose) {
					_.each(data.txsummary, function (obj) {
						printObject.printObject(obj, obj['@metadata'].entity, 0, obj['@metadata'].verb);
					});
				}
				else {
					printObject.printObject(newProj, newProj['@metadata'].entity, 0, newProj['@metadata'].verb);
					console.log(('and ' + (data.txsummary.length - 1) + ' other objects').grey);
				}
				var trailer = "Request took: " + (endTime - startTime) + "ms";
				trailer += " - # objects touched: ";
				if (data.txsummary.length == 0) {
					console.log('No data returned'.yellow);
				}
				else {
					trailer += data.txsummary.length;
				}
				printObject.printTrailer(trailer);

				dotfile.setCurrentProject(newProj.ident, cmd.api_name, data.url_name);
			});
		});
	},

	update: function (cmd) {
		var client = new Client();
		var loginInfo = login.login(cmd);
		if (!loginInfo)
			return;

		var apiKey = loginInfo.apiKey;
		if (!apiKey) {
			console.log(("Error: Login apiKey is missing or empty").red);
			return;
		}

		var filter = null;
		var projIdent = cmd.project_ident;

		if (cmd.ident) {
			filter = "?sysfilter=equal(ident:" + cmd.ident + ")";
		} else if (!projIdent) {
			projIdent = dotfile.getCurrentProject();
			if (!projIdent) {
				console.log('There is no current project.'.yellow);
				return;
			}
			filter = "/" + projIdent;
		}
		if (!filter) {
			console.log('Missing parameter: please specify either ident or use a specific API (lacadmin api use --url_name myAPI)'.red);
			return;
		}
		client.get(loginInfo.url + "/AllProjects" + filter, {
			headers: {
				Authorization: "CALiveAPICreator " + apiKey + ":1",
				"Content-Type": "application/json"
			}
		}, function (data) {
			//console.log('get result: ' + JSON.stringify(data, null, 2));
			if (data.errorMessage) {
				console.log(("API Update Error: " + data.errorMessage).red);
				return;
			}

			if (data.length === 0) {
				console.log(("API not found").red);
				return;
			}
			if (data.length > 1) {
				console.log(("API Update Error: more than one API for the given condition: " + filter).red);
				return;
			}
			var project = data[0];
			if (cmd.api_name) {
				project.name = cmd.api_name;
			}
			if (cmd.url_name) {
				project.url_name = cmd.url_name;
			}
			if (cmd.url) {
				project.url = cmd.url;
			}
			if (cmd.comments) {
				project.comments = cmd.comments;
			}
			if (cmd.authprovider) {
				project.authprovider_ident = cmd.authprovider;
			}
			if (cmd.status) {
				if (cmd.status !== 'A' && cmd.status !== 'I') {
					console.log('API status must be either A (for active) or I (for inactive). Default is A if unspecified.'.red);
					return;
				}
				project.is_active = cmd.status == "A";
			}
			//{"@metadata" : {"action":"MERGE_INSERT", "key":"ident"}
			var startTime = new Date();
			client.put(project['@metadata'].href, {
				data: project,
				headers: {
					Authorization: "CALiveAPICreator " + loginInfo.apiKey + ":1",
					"Content-Type": "application/json"
				}
			}, function (data) {
				var endTime = new Date();
				if (data.errorMessage) {
					console.log(data.errorMessage.red);
					return;
				}
				printObject.printHeader('API was updated, including the following objects:');
				_.each(data.txsummary, function (obj) {
					printObject.printObject(obj, obj['@metadata'].entity, 0, obj['@metadata'].verb);
				});
				var trailer = "Request took: " + (endTime - startTime) + "ms";
				trailer += " - # objects touched: ";
				if (data.txsummary.length == 0) {
					console.log('No data returned'.yellow);
				}
				else {
					trailer += data.txsummary.length;
				}
				printObject.printTrailer(trailer);
			});
		});
	},
	del: function (cmd) {
		var client = new Client();
		var loginInfo = login.login(cmd);
		if (!loginInfo) {
			console.log('You are not currently logged into any API Creator Server (use login).'.red);
			return;
		}

		var filt = null;
		if (cmd.url_name) {
			filt = "equal(url_name:'" + cmd.url_name + "')";
		}
		else if (cmd.api_name) {
			filt = "equal(name:'" + cmd.api_name + "')";
		}
		else {
			console.log('Missing parameter: please specify either api_name or url_name'.red);
			return;
		}
		client.get(loginInfo.url + "/projects?sysfilter=" + filt, {
			headers: {
				Authorization: "CALiveAPICreator " + loginInfo.apiKey + ":1",
				"Content-Type": "application/json"
			}
		}, function (data) {
			//console.log('get result: ' + JSON.stringify(data, null, 2));
			if (data.errorMessage) {
				console.log(("Error: " + data.errorMessage).red);
				return;
			}
			if (data.length === 0) {
				console.log(("API " + cmd.api_name + "  does not exist").yellow);
				return;
			}
			if (data.length > 1) {
				console.log(("Error: more than one API for the given condition: " + filter).red);
				return;
			}
			var project = data[0];
			var startTime = new Date();
			client['delete'](project['@metadata'].href + "?checksum=" + project['@metadata'].checksum, {
				headers: {
					Authorization: "CALiveAPICreator " + loginInfo.apiKey + ":1",
					"Content-Type": "application/json"
				}
			}, function (data2) {
				var endTime = new Date();
				if (data2.errorMessage) {
					console.log(data2.errorMessage.red);
					return;
				}
				printObject.printHeader('API was deleted, including the following objects:');


				var delProj = _.find(data2.txsummary, function (p) {
					return p['@metadata'].resource === 'admin:projects';
				});
				if (!delProj) {
					console.log('ERROR: unable to find deleted API'.red);
					return;
				}
				if (cmd.verbose) {
					_.each(data2.txsummary, function (obj) {
						printObject.printObject(obj, obj['@metadata'].entity, 0, obj['@metadata'].verb);
					});
				}
				else {
					printObject.printObject(delProj, delProj['@metadata'].entity, 0, delProj['@metadata'].verb);
					console.log(('and ' + (data2.txsummary.length - 1) + ' other objects').grey);
				}

				var trailer = "Request took: " + (endTime - startTime) + "ms";
				trailer += " - # objects touched: ";
				if (data2.txsummary.length == 0) {
					console.log('No data returned'.yellow);
				}
				else {
					trailer += data2.txsummary.length;
				}
				printObject.printHeader(trailer);
			});
		});
	},
	use: function (cmd) {
		var client = new Client();
		var loginInfo = login.login(cmd);
		if (!loginInfo)
			return;

		var filter = null;
		if (cmd.url_name) {
			filter = "equal(url_name:'" + cmd.url_name + "')";
		}
		else if (cmd.api_name) {
			filter = "equal(name:'" + cmd.api_name + "')";
		}
		else {
			console.log('Missing parameter: please specify either api_name or url_name'.red);
			return;
		}

		client.get(loginInfo.url + "/projects?sysfilter=" + filter, {
			headers: {
				Authorization: "CALiveAPICreator " + loginInfo.apiKey + ":1",
				"Content-Type": "application/json"
			}
		}, function (data) {
			//console.log('get result: ' + JSON.stringify(data, null, 2));
			if (data.errorMessage) {
				console.log(("Error: " + data.errorMessage).red);
				return;
			}
			if (data.length === 0) {
				console.log(("API not found").red);
				return;
			}
			if (data.length > 1) {
				console.log(("Error: more than one API for the given condition: " + filter).red);
				return;
			}
			var project = data[0];
			dotfile.setCurrentProject(project.ident, project.name, project.url_name);
		});
	},
	export: function (cmd) {
		var client = new Client();
		var loginInfo = login.login(cmd);
		if (!loginInfo)
			return;

		var filter = null;
		var projIdent = cmd.ident;
		filter = "equal(ident:" + projIdent + ")";
		if (cmd.url_name) {
			filter = "equal(url_name:'" + cmd.url_name + "')";
		} else if (cmd.api_name) {
			filter = "equal(name:'" + cmd.api_name + "')";
		} else if (!projIdent) {
			projIdent = dotfile.getCurrentProject();
			if (!projIdent) {
				console.log('No current project selected'.red);
				return;
			}
			filter = "equal(ident:" + projIdent + ")";
		} else {
			console.log('Missing parameter: please specify either api_name or url_name'.red);
			return;
		}
		//add support for export format from JSON to ZIP (default:json)
		var toStdout = false;
		if (!cmd.file) {
			toStdout = true;
		}

		client.get(loginInfo.url + "/ProjectExport?sysfilter=" + filter, {
			headers: {
				Authorization: "CALiveAPICreator " + loginInfo.apiKey + ":1",
				"Content-Type": "application/json"
			}
		}, function (data) {
			//console.log('get result: ' + JSON.stringify(data, null, 2));
			if (data.errorMessage) {
				console.log(("Error: " + data.errorMessage).red);
				return;
			}
			if (data.length === 0) {
				console.log(("Error: no such project").red);
				return;
			}

			if (toStdout) {
				console.log(JSON.stringify(data, null, 2));
			}
			else {
				var exportFile = fs.openSync(cmd.file, 'w+', 0600);
				fs.writeSync(exportFile, JSON.stringify(data, null, 2));
				console.log(('Project has been exported to file: ' + cmd.file).green);
			}
		});
	},
	import: function (cmd) {
		console.log("import called");
		if (cmd.directory) {
			//testing block ////
			var zip = new AdmZip();
			module.exports.readDirectory(cmd, zip);
			var zipEntries = zip.getEntries();
			zipEntries.forEach(function (zipEntry) {
				console.log("Entry "+ zipEntry.getName());
			});
			console.log("Import from directory not implementned".red);
			return;
			////////
		}
		if (cmd.directory) {
			module.exports.importFromDir(cmd);
			return;
		} else {
			var isZIPFile = false;
			if (cmd.format && cmd.format.toLowerCase() == "zip") {
				isZIPFile = true;
			} else {
				if (cmd.file) {
					isZIPFile = cmd.file.endsWith(".zip");
				}
			}
			if (isZIPFile) {
				module.exports.importFromZIPFile(cmd);
			} else {
				module.exports.importFromJSONFile(cmd);
			}
			return;
		}
		//console.log("import requires either --file (type zip or json) or --directory".red);
	},
	importFromDir: function (cmd) {
		//we will read from a source directory and build the zip file to send to LAC
		console.log("import called on directory " + cmd.directory);
		var zip = new AdmZip();
		module.exports.readDirectory(cmd, zip);
		var client = new Client();
		var loginInfo = login.login(cmd);
		if (!loginInfo) {
			return;
		}
		if (zip) {

			var willSendthis = zip.toBuffer();
			fs.writeFileSync("/Users/banty01/test.zip", willSendthis);
			//zip.writeZip(/*target file name*/"/Users/banty01/test.zip");
			console.log("zip file written to /Users/banty01/test.zip");
		}
	},
	importFromZIPFile: function (cmd) {
		console.log("Import API using zip file " + cmd.file);
		var client = new Client();
		var loginInfo = login.login(cmd);
		if (!loginInfo) {
			return;
		}

		if (!cmd.file) {
			console.log("ZIP --file <name.zip> is required".red);
			return;
		}
		var endPoint = "/@import";
		var url = loginInfo.url;

		var args = "";
		var collision = "rename_new"; //original behavior
		var errorhandling = "standard";
		if (cmd.namecollision) {
			collision = cmd.namecollision.toLowerCase();
			if (collision !== 'rename_new' && collision !== 'replace_existing' && collision !== 'fail'
				&& collision !== 'disable_and_rename_existing') {
				console.log("invalid namecollision value " + collision);
				return;
			}
		}
		if (cmd.errorhandling) {
			errorhandling = cmd.errorhandling.toLowerCase();
			if (errorhandling !== 'standard' && errorhandling !== 'fail_on_warning' && errorhandling !== 'best_efforts') {
				console.log("invalid errorhandling value " + collision);
				return;
			}
		}
		args = "?namecollision=" + collision + "&errorhandling=" + errorhandling;
		console.log(url + endPoint + args);

		var fileName = cmd.file;
		var readStream = fs.createReadStream(fileName);
		readStream.on('data', function (chunk) {
			console.log("reading chunk .. " + chunk.length);
		})

		var uploadOptions = {
			name: 'foo.zip',
			file: readStream
		};
		request.post({
				url: url + endPoint + args,
				headers: {
					"Authorization": "CALiveAPICreator " + loginInfo.apiKey + ":1",
					"Content-Type": 'multipart/form-data'
				},
				formData: uploadOptions,
			},
			function (err, resp, body) {
				if (err) {
					console.log('Error ', err);
				} else {
					console.log('@import message', body);
				}
			});
	},
	importFromJSONFile: function (cmd) {
		console.log("Import JSON API using file " + cmd.file);
		var client = new Client();
		var loginInfo = login.login(cmd);
		if (!loginInfo) {
			return;
		}

		if (!cmd.file) {
			cmd.file = '/dev/stdin';
		}
		var endPoint = "/@import"; //4.1 style
		var isZIPFile = false;
		if (cmd.file) {
			isZIPFile = cmd.file.endsWith(".zip");
		}
		var args = "";
		var collision = "rename_new"; //original behavior
		var errorhandling = "standard";
		if (cmd.namecollision) {
			collision = cmd.namecollision.toLowerCase();
			if (collision !== 'rename_new' && collision !== 'replace_existing' && collision !== 'fail'
				&& collision !== 'disable_and_rename_existing') {
				console.log("invalid namecollision value " + collision);
				return;
			}
		}
		if (cmd.errorhandling) {
			errorhandling = cmd.errorhandling.toLowerCase();
			if (errorhandling !== 'standard' && errorhandling !== 'fail_on_warning' && errorhandling !== 'best_efforts') {
				console.log("invalid errorhandling value " + collision);
				return;
			}
		}
		args = "?namecollision=" + collision + "&errorhandling=" + errorhandling;
		var fileContent = fs.readFileSync(cmd.file);
		var contentType = "application/json";
		if (!isZIPFile) {
			fileContent = JSON.parse(fileContent);
			if (fileContent.length > 0) {
				endPoint = "/ProjectExport"; // 4.0 and earlier style
				args = ""; //not hondred
			}
		}

		if (cmd.api_name) {
			fileContent[0].name = cmd.api_name;
		}
		if (cmd.url_name) {
			fileContent[0].url_name = cmd.url_name;
		}

		console.log("endPoint: " + loginInfo.url + endPoint + args);
		var startTime = new Date();
		client.post(loginInfo.url + endPoint + args, {
			data: fileContent,
			headers: {
				Authorization: "CALiveAPICreator " + loginInfo.apiKey + ":1",
				"Content-Type": contentType
			}
		}, function (data) {

			var endTime = new Date();
			if (data.errorMessage) {
				console.log(data.errorMessage.red);
				return;
			}
			printObject.printHeader('API was created, including:');
			if (data.statusCode == 200) {
				console.log("Request took: " + (endTime - startTime) + "ms");
				return;
			}

			console.log("API import completed using edpoint: " + endPoint);
			var trailer = "Request took: " + (endTime - startTime) + "ms";
			trailer += " - # objects touched: ";
			if (data.length === 0) {
				console.log('No data returned'.yellow);
			}
			else {
				trailer += " : " + JSON.stringify(data, null, 2);
			}
			if (data && data.success) {
				var imported = data.imported;
				if (Array.isArray(imported)) {
					var i = 0;
					//Only process the first one -there may be multiple
					if (i < imported.length) {
						var newIdent = imported[i].projectIdent;
						var projName = imported[i].projectName;
						var url_name = imported[i].projectUrlFragment;
						//set the imported project to be the current selected project
						dotfile.setCurrentProject(newIdent, projName, url_name);
						console.log("API is now using project ident: " + newIdent + " name: " + projName + ' url_name:' + url_name);
					}
				}
			}
			printObject.printHeader(trailer);
		});
	},
	extract: function (cmd) {
		if (!cmd.file) {
			console.log(("--file must exist type must be zip, and is required").red);
			return;
		}
		if (!cmd.directory) {
			console.log(("--directory to explode zip file must exist and is required  ").red);
			return;
		}
		//synchronize files with file system
		var path = "~/tmp/";
		if (cmd.directory) {
			path = cmd.directory;
		}

		var synchronize = false; //merge [default]
		if (cmd.synchronize) {
			console.log("synchronize: "+ cmd.synchronize);
			synchronize = cmd.synchronize == "replace"?true:false;
		}
		//var fileContent = fs.readFileSync(cmd.file);//JSON.parse(fs.readFileSync(cmd.file)
		console.log("extract zip file " + cmd.file + " to directory " + path + " synchronize: " + (synchronize?"replace":"merge"));
		//does this target directory exist - if not - we can skip this next part.
		var filesToDelete = [];
		var dirsToDelete = [];
		var foundFiles = [];
		var foundDirs = [];
		var filename;
		var zip = new AdmZip(cmd.file);
		if (fs.existsSync(path) && synchronize) {
			var zipEntries = zip.getEntries();
			zipEntries.forEach(function (zipEntry) {
				// get a list of files from the zip file
				if (zipEntry.isDirectory) {
					module.exports.removeDirectory(zipEntry.entryName);
					//console.log("{d} " + zipEntry.entryName);
					fs.readdir(path + "/" + zipEntry.entryName, function (err, items) {
						//if this directory does NOT exist in target - then ok
						//get a list of all files in this directory
						foundDirs = []; //lets get a list of directories at this level
						fs.readdir(path + "/" , function (err, items) {
							for (var i = 0; items && i < items.length; i++) {
								filename = path + "/" + items[i];
								var stats = fs.lstatSync(filename);
								if (stats.isDirectory()) {
									foundDirs.push(filename);
								}
							}
						});
						for (var i = 0; items && i < items.length; i++) {
							filename = path + "/" + zipEntry.entryName + items[i];
							var stats = fs.lstatSync(filename);
							if (!stats.isDirectory()) {
								//console.log("....Found files on disk {f} " + filename);
								foundFiles.push(filename);
								var found = false;
								var name;
								zipEntries.forEach(function (entry) {
									if (!entry.isDirectory) {
										name = path + "/" + entry.entryName;
										//console.log(">>>compare "+filename + " = " + name );
										if (filename == name) {
											found = true;
										}
									} else {
										// is a directory - is it in foundDirs
										//if not then we remove the directory
										var foundDir = false;
										for(var dir in foundDirs) {
											console.log("testing "+ dir + " " + entry.entryName + " "+foundDirs[dir]);
											if(foundDirs[dir] == entry.entryName) {
												foundDir = true;
												continue;
											}
										}
										if(!foundDir) {
											//console.log("Delete Directory contents {d}" + entry.entryName);
											//module.exports.removeDirectory(entry.entryName);
										}
									}
								});
								if (!found) {
									filesToDelete.push(filename);
									console.log("delete file {f} " + filename);
									fs.unlink(filename, function (err) {
										if (err) {
											console.log("ERROR :" + err);
										} else {
											console.log('file deleted successfully');
										}
									});
								}
							}
						}
					});
				}
			});
		}
		//write the ZIP contents to a known location
		zip.extractAllTo(cmd.directory, true);
		console.log("extract completed to directory " + path);
	},
	removeDirectory: function(path) {
		console.log("Remove directory, files, and sub dirs starting at:" + path);
		var  rmdirAsync = function(path, callback) {
			fs.readdir(path, function(err, files) {
				if(err) {
					// Pass the error on to callback
					callback(err, []);
					return;
				}
				var wait = files.length,
					count = 0,
					folderDone = function(err) {
						count++;
						// If we cleaned out all the files, continue
						if( count >= wait || err) {
							fs.rmdir(path,callback);
						}
					};
				// Empty directory to bail early
				if(!wait) {
					folderDone();
					return;
				}

				// Remove one or more trailing slash to keep from doubling up
				path = path.replace(/\/+$/,"");
				files.forEach(function(file) {
					var curPath = path + "/" + file;
					fs.lstat(curPath, function(err, stats) {
						if( err ) {
							callback(err, []);
							return;
						}
						if( stats.isDirectory() ) {
							console.log("remove direcotry "+ curPath);
							rmdirAsync(curPath, folderDone);
						} else {
							console.log("unlink "+curPath);
							fs.unlink(curPath, folderDone);
						}
					});
				});
			});
		};
	},
	exportToFile: function (cmd) {
		//Take an existing ZIP file and explode into a directory using ZIP utility
		var client = new Client();
		var loginInfo = login.login(cmd);
		if (!loginInfo)
			return;
		var exportEndpoint = "@export";
		var filter = null;
		var projIdent = cmd.ident;
		filter = "?";
		if (cmd.url_name) {
			var sep = "";
			var urlfrags = cmd.url_name.split(",")
			for (var i = 0; i < urlfrags.length; i++) {
				filter += sep + "urlfragment=" + urlfrags[i];
				sep = "&";
			}
		} else if (!projIdent) {
			projIdent = dotfile.getCurrentProject();
			if (!projIdent) {
				console.log('No current API ident found - use $lacadmin api list'.red);
				return;
			}
			filter = "?projectId=" + projIdent;
		} else {
			console.log('Missing parameter: please specify API --url_name or --ident'.red);
			return;
		}
		//we could have a switch for JSON or ZIP
		var contentType = "application/json";
		var format = "json";
		if (cmd.format) {
			format = cmd.format.toLowerCase();
		}
		if (format !== 'zip' && format !== 'json') {
			console.log('Valid format must be either zip or json'.red);
			return;
		}

		var passwordStyle = cmd.passwordstyle || "skip";
		var authTokenStyle = cmd.authTokenstyle || "skip_auto";
		var apiOptionsStyle = cmd.apioptionsstyle || "emit_all";
		var libraryStyle = cmd.librarystyle || "emit_all";
		filter += "&responseformat=" + format
			+ "&passwordstyle=" + passwordStyle
			+ "&authtokenstyle=" + authTokenStyle
			+ "&apioptionsstyle=" + apiOptionsStyle
			+ "&librarystyle=" + libraryStyle;
		//section can be comma separated - we may want to include a filter
		//entity
		if (cmd.section) {
			filter += "&section=" + cmd.section;
			if (cmd.section_filter) {
				var sep = cmd.section_filter.substr(0) == '&' ? "" : "&";
				filter += sep + cmd.section_filter;
			}
			filter += "&skipUrlFragmentWrapping=true";
		}
		var toStdout = false;
		var filename;
		if (!cmd.file) {
			toStdout = true;
		} else {
			if (!cmd.file.endsWith(".zip") && !cmd.file.endsWith(".json")) {
				console.log('File Name extension must end with .zip or .json'.red);
				return;
			}
		}
		if (format == 'zip' || (cmd.file && cmd.file.endsWith(".zip"))) {
			contentType = 'application/zip';
		}
		console.log(loginInfo.url + "/" + exportEndpoint + filter);
		client.get(loginInfo.url + "/" + exportEndpoint + filter, {
			headers: {
				Authorization: "CALiveAPICreator " + loginInfo.apiKey + ":1",
				"Content-Type": contentType,
				"accept": "*/*"
			}
		}, function (data) {
			//console.log('get result: ' +data);
			if (data.errorMessage) {
				console.log(("Error: " + data.errorMessage).red);
				return;
			}
			if (data.length === 0) {
				console.log(("Error: no such API to export").red);
				return;
			}
			if (format == 'zip') {
				var buf = new Buffer(data, 'utf8');
				if (toStdout) {
					console.log(buf);
				}
				else {
					var exportFile = fs.openSync(cmd.file, 'w+', 0600);
					fs.writeSync(exportFile, buf);
					console.log(('API has been exported to file: ' + cmd.file + ' using format ' + format).green);
				}
			} else {
				if (toStdout) {
					console.log(JSON.stringify(data, null, 2));
				}
				else {
					var exportFile = fs.openSync(cmd.file, 'w+', 0600);
					fs.writeSync(exportFile, JSON.stringify(data, null, 2));
					console.log(('API extract has been exported to file: ' + cmd.file + ' using format ' + format).green);
				}

			}
		});
	},
	readDirectory: function (cmd, zip) {
	var __dirname = cmd.directory;

	var addZipPromise = function addZipPromise(filename, content) {
		return new Promise(function(resolve, reject){
			console.log("zip.addLocalFile " + filename + " content "+ content);
			zip.addFile(filename,content);
			//.then(function (resp) {
				//try {
				//	resolve(zip.addLocalFile(filename));
			//	} catch(ex) {
			//		reject(ex);
			//	}
			//} ,reject);
		});
 	}

	var allowedFiles = ['.json', '.js', '.md', '.html', '.sql'];
	dir.readFiles(__dirname, function (err, content, filename, next) {
		for(var ext in allowedFiles) {
			//console.log(allowedFiles[ext]);
			if(filename.indexOf(allowedFiles[ext]) > -1) {
				addZipPromise(filename, content);
				continue;
			}
		}
		next();
	});
  }
}

