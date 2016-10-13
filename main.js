var esprima = require("esprima");
var options = {tokens:true, tolerant: true, loc: true, range: true };
var faker = require("faker");
var fs = require("fs");
faker.locale = "en";
var mock = require('mock-fs');
var _ = require('underscore');
var Random = require('random-js');

function main()
{
	var args = process.argv.slice(2);

	if( args.length == 0 )
	{
		args = ["subject.js"];
	}
	var filePath = args[0];

	constraints(filePath);

	generateTestCases()

}

var engine = Random.engines.mt19937().autoSeed();

function createConcreteIntegerValue( greaterThan, constraintValue )
{
	if( greaterThan )
		return Random.integer(constraintValue,constraintValue+10)(engine);
	else
		return Random.integer(constraintValue-10,constraintValue)(engine);
}

function Constraint(properties)
{
	this.ident = properties.ident;
	this.expression = properties.expression;
	this.operator = properties.operator;
	this.value = properties.value;
	this.funcName = properties.funcName;
	// Supported kinds: "fileWithContent","fileExists"
	// integer, string, phoneNumber
	this.kind = properties.kind;
}

function fakeDemo()
{
	console.log( faker.phone.phoneNumber() );
	console.log( faker.phone.phoneNumberFormat() );
	console.log( faker.phone.phoneFormats() );
}

var functionConstraints =
{
}

var mockFileLibrary = 
{
	pathExists:
	{
		'path/fileExists': {}
	},
	fileWithContent:
	{
		pathContent: 
		{	
  			file1: 'text content',
  			file2: '',
		}
	}
};

//this generates cartesianProduct: Used this function from Stack Overflow i.e. generate cartesianProduct for a list of values in node js
function cartesianProduct(list) {
    return _.reduce(list, function(a, b) {
        return _.flatten(_.map(a, function(x) {
            return _.map(b, function(y) {
                return x.concat([y]);
            });
        }), true);
    }, [ [] ]);
};

function generateTestCases()
{

    console.log(functionConstraints);
	var content = "var subject = require('./subject.js')\nvar mock = require('mock-fs');\n";
	for ( var funcName in functionConstraints )
	{
		
		// update parameter values based on known constraints.
		var constraints = functionConstraints[funcName].constraints;
		// Handle global constraints...
		var fileWithContent = _.some(constraints, {kind: 'fileWithContent' });
		var pathExists      = _.some(constraints, {kind: 'fileExists' });

		var phoneNumber = false
		var options = false
		var numberList = [[0,1,2,3,4,5,6,7,8,9], [0,1,2,3,4,5,6,7,8,9], [0,1,2,3,4,5,6,7,8,9]]
		var params = {};
		
		// initialize params
		for(var i =0; i < functionConstraints[funcName].params.length; i++)
		{
			var paramName = functionConstraints[funcName].params[i];
			//params[paramName] = '\'' + faker.phone.phoneNumber()+'\'';
			//params[paramName] = '\'\'';
			params[paramName] = ['\'\'']
			if (paramName == "phoneNumber")
			{
				phoneNumber = true
			}
			if( paramName == "options") 
			{
				options = true
			}
			
		}

		// plug-in values for parameters
		for( var c = 0; c < constraints.length; c++ )
		{
			
			var constraint = constraints[c];
		

            if( params.hasOwnProperty( constraint.ident ) )
            {
                if (constraint.ident == "dir")
                {
                    if( constraint.kind == "fileExists")
                    {
                        params[constraint.ident].push(constraint.value);
                    }
                }
                else if (constraint.ident == "filePath")
                {
                    if( constraint.kind == "fileWithContent")
                    {
                        params[constraint.ident].push(constraint.value);
                    }
                }
                else {

                    params[constraint.ident].push(constraint.value);
                }
            }



			
		}

		
		var list = Object.keys(params).map( function(x) { return params[x] } );
		
		//pass a list of lists to generate all possible combinations: cartesian product [[1,2][3,4]] = [1,3],[1,4],[2,3],[2,4]
		combinations = cartesianProduct(list);
		
		for (var i=0; i< combinations.length; i++) {
			content += "subject.{0}({1});\n".format(funcName, combinations[i] );
		
			if( pathExists || fileWithContent )
			{
				
				var argument = combinations[i].join(',')
				if (argument != "'',''")
				{
					// console.log(argument)
					content += generateMockFsTestCases(pathExists,fileWithContent,funcName, argument);
					content += generateMockFsTestCases(!pathExists,fileWithContent,funcName, argument);
					content += generateMockFsTestCases(pathExists,!fileWithContent,funcName, argument);
					content += generateMockFsTestCases(!pathExists,!fileWithContent,funcName, argument);
				}
			}
	
		}
	
		if(phoneNumber)
		{ 
			numberCombinations = cartesianProduct(numberList)
			for (var i=0; i< numberCombinations.length; i++) {
				var phoneNumber= "'" + numberCombinations[i].toString().split(',').join('') + "1234567'";
				
				
				params["phoneNumber"] = phoneNumber				

				if(options)
				{
					params["options"] = "'ispresent'"
				}
				
				var args = Object.keys(params).map( function(k) {return params[k]; }).join(",");
				content += "subject.{0}({1});\n".format(funcName, args );
			}

		}

	}


	fs.writeFileSync('test.js', content, "utf8");

}

function generateMockFsTestCases (pathExists,fileWithContent,funcName,args) 
{
	var testCase = "";
	// Build mock file system based on constraints.
	var mergedFS = {};
	if( pathExists )
	{
		for (var attrname in mockFileLibrary.pathExists) { mergedFS[attrname] = mockFileLibrary.pathExists[attrname]; }
	}
	if( fileWithContent )
	{
		for (var attrname in mockFileLibrary.fileWithContent) { mergedFS[attrname] = mockFileLibrary.fileWithContent[attrname]; }
	}

	testCase += 
	"mock(" +
		JSON.stringify(mergedFS)
		+
	");\n";

	testCase += "\tsubject.{0}({1});\n".format(funcName, args );
	testCase+="mock.restore();\n";
	return testCase;
}

function constraints(filePath)
{
   var buf = fs.readFileSync(filePath, "utf8");
	var result = esprima.parse(buf, options);

	traverse(result, function (node) 
	{
		if (node.type === 'FunctionDeclaration') 
		{
			var funcName = functionName(node);
			var params = node.params.map(function(p) {return p.name});

			functionConstraints[funcName] = {constraints:[], params: params};

			// Check for expressions using argument.
			traverse(node, function(child)
			{
				if( child.type === 'BinaryExpression' && child.operator == "==")
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1)
					{
						// get expression from original source code:
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1]);

						
						functionConstraints[funcName].constraints.push( 
						new Constraint(
						{
							ident: child.left.name,
							value: rightHand,
							funcName: funcName,
							kind: "string",		
						}));

						var newValue = "'"+rightHand+"rand'";
						functionConstraints[funcName].constraints.push( 
						new Constraint(
						{
							ident: child.left.name,
							value: newValue,
							funcName: funcName,
							kind: "string",	
						}));
						
					}
				



				if ( child.left.type == 'CallExpression' && params.indexOf( child.left.callee.object.name ) > -1 ) 
				{

					 var expression = buf.substring(child.range[0], child.range[1]);
                     var newValue = ''
                        for (var i=0 ; i<=child.right.value; i++)
                        {
                            if (i == child.right.value)
                            {
                                newValue += child.left.arguments[0].value
                            }

                            else
                            {
                                  newValue += "r";
                            }
                        }
                        
                        functionConstraints[funcName].constraints.push( 
                            new Constraint(
                            {
                                ident: child.left.callee.object.name,
                                value: "'"+ newValue + "'",
                                funcName: funcName
                            }));    

				}

				}


				
				if( child.type === 'BinaryExpression' && child.operator == "<")
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1) 
					{
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])

						functionConstraints[funcName].constraints.push( 
						new Constraint(
						{
							ident: child.left.name,
							value: rightHand+1,
							funcName: funcName,
							kind: "integer",
							
						}));
						
						functionConstraints[funcName].constraints.push( 
						new Constraint(
						{
							ident: child.left.name,
							value: rightHand-1,
							funcName: funcName,
							kind: "integer",
						}));
					}

				}

				if( child.type === 'BinaryExpression' && child.operator == "!=")
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1 )
					{
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])

						functionConstraints[funcName].constraints.push( 
						new Constraint(
						{
							ident: child.left.name,
							value: rightHand,
							funcName: funcName,
							kind: "string",	
						}));
						
						functionConstraints[funcName].constraints.push( 
						new Constraint(
						{
							ident: child.left.name,
							value: "'"+rightHand+"rand'",
							funcName: funcName,
							kind: "string",	
						}));

						
					}

				}


				if( child.type === 'BinaryExpression' && child.operator == ">")
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1) 
					{
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])

						
						functionConstraints[funcName].constraints.push( 
						new Constraint(
						{
							ident: child.left.name,
							value: rightHand,
							funcName: funcName,
							kind: "integer",
						}));

						functionConstraints[funcName].constraints.push( 
						new Constraint(
						{
							ident: child.left.name,
							value: rightHand+1,
							funcName: funcName,
							kind: "integer",
						}));
						
					}

				}


				if( child.type == "CallExpression" && 
					 child.callee.property &&
					 child.callee.property.name =="readFileSync" )
				{
					for( var p =0; p < params.length; p++ )
					{
						if( child.arguments[0].name == params[p] )
						{

							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: params[p],
								value:  "'pathContent/file1'",
								funcName: funcName,
								kind: "fileWithContent",
							}));

							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: params[p],
								value:  "'pathContent/file2'",
								funcName: funcName,
								kind: "fileWithContent",
							}));
						}
					}
				}

			});

			
		}
	});
}

function traverse(object, visitor) 
{
    var key, child;

    visitor.call(null, object);
    for (key in object) {
        if (object.hasOwnProperty(key)) {
            child = object[key];
            if (typeof child === 'object' && child !== null) {
                traverse(child, visitor);
            }
        }
    }
}

function traverseWithCancel(object, visitor)
{
    var key, child;

    if( visitor.call(null, object) )
    {
	    for (key in object) {
	        if (object.hasOwnProperty(key)) {
	            child = object[key];
	            if (typeof child === 'object' && child !== null) {
	                traverseWithCancel(child, visitor);
	            }
	        }
	    }
 	 }
}

function functionName( node )
{
	if( node.id )
	{
		return node.id.name;
	}
	return "";
}


if (!String.prototype.format) {
  String.prototype.format = function() {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function(match, number) { 
      return typeof args[number] != 'undefined'
        ? args[number]
        : match
      ;
    });
  };
}

main();