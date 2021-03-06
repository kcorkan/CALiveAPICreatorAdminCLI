"out = java.lang.System.out;\n\nfunction copyTableService( targetPrefix) {\n    log.debug('Copy Tables')\n    var mds = adminDataService();\n    var apikey = \"data_full\";\n    var adminURL = req.getBaseUrl(); \n    adminURL = adminURL.replace(\"default\",\"abl\");\n    adminURL = adminURL.replace(\"csvparser\",\"admin\");\n    log.debug(adminURL + \"v2/\");\n    var config = { \n        \"adminUrl\": adminURL + \"v2\", \n        \"adminApiKey\": apikey , \n        \"project_url\": \"csvparser\",\n        \"prefix\": targetPrefix ,\n        \"tableName\": \"replaceMe\"\n    };\n    \n    apikey = mds.adminAuthWithURL(config.adminUrl,\"admin\",\"Password1\");\n    log.debug(\"LOOKUP ADMIN APIKEY \"+apikey);\n    config.adminApiKey = apikey;\n    \n    var url = req.baseUrl +\"v1/@tables\";\n    var settings = { headers: {\"Authorization\": \"CALiveAPICreator data_full:1\"}};\n    var resp = SysUtility.restGet(url, null, settings);\n    logicContext.logDebug(resp);\n    var tables = JSON.parse(resp);\n    // 1 get list of @tables and columns\n    for(var i in tables) {\n        var tableName = tables[i].entity;\n        config.tableName = tableName;\n        mds.configure(config);\n        log.debug(\"Table \"+tableName);\n        log.debug(JSON.stringify(mds.createNewTable(),null,2));//<<<< CREATE TABLE HERE>>>>>\n        var colurl = url + \"/\" + tables[i].name;\n        resp = SysUtility.restGet(colurl, null, settings);\n        logicContext.logDebug(resp);\n        var cols = JSON.parse(resp);\n        // 2. for each table create new table in schema 'csv'\n        // 3. get @tables/tablename - get columns\n        // 4. add columns to new table\n        for(var j in cols.columns){\n            var coldef = {};\n            if(cols.columns[j].name !== 'ident') {\n                coldef.name = cols.columns[j].name;\n                coldef.generic_type = cols.columns[j].generic_type || \"string\";\n                coldef.size = cols.columns[j].length || 0;\n                coldef.nullable = true;// cols.columns[j].nullable;\n                log.debug(JSON.stringify(coldef,null,2));\n                log.debug(JSON.stringify(mds.createNewColumn(coldef),null,2));//<<<< CREATE EACH COLUMN HERE>>>>>\n            }\n        }\n    }\n\n//relns will be done using virtual defs on datasource\n\n}"