//modules ==========================================

// ExpressJS 4.0 used for the middleware and web framework
var express = require('express');
var bodyParser = require('body-parser');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var flash = require('connect-flash');

// Modules for handling xml requests and responses
var jsxml = require("node-jsxml");
var XMLWriter = require('xml-writer');
var request = require("request");

var app = express();

app.set('views', __dirname + '/views');
app.use(express.static(__dirname + '/public'));
app.use(bodyParser());
// ejs (embedded javascript) used as the template engine
app.engine('html', require('ejs').renderFile);
app.use(cookieParser('Ronaldinho'));
app.use(session());
app.use(flash());

//'database' of users
//Each user is a property in this object whose value is that user's pw.
// EG if a user's login is mike/hello then users['mike'] == "hello"
var users = {};

app.get('/', function(req,res) {
	res.render('login.ejs', {
		error: req.flash('error'),
		success: req.flash('success')
	});
});

app.get('/signup', function(req,res) {
	res.render('signup.ejs', {
		error: req.flash('error'),
		success: req.flash('success')
	});
});

app.post('/user', function(req,res) {
	if(req.body.user.length === 0) {
		req.flash('error', "please choose a username");
		res.redirect('/signup');
	} else if(req.body.pass.length === 0) {
		req.flash('error', "please choose a password");
	} else if(users[req.body.user]) {
		req.flash('error', 'user already exists');
		res.redirect('/signup');
	} else if(req.body.pass != req.body.conf) {
		req.flash('error', "password and pw confirmation don't match");
		res.redirect('/signup');
	} else {
		// OK everything looks good. Let's create this user on Tableau Server with the REST API
		createUser(req.body.user, function(err) {
			if(err) {
				req.flash('error', "Error while posting to Server: " + err);
				res.redirect('/signup');
			} else {
				users[req.body.user] = req.body.pass;
				req.flash('success', "User added");
				res.redirect('/');
			}
		});
	}
});

app.post('/login', function(req,res) {
	if(req.body.password === users[req.body.user]) {
		req.session.user = req.body.user;
		res.redirect('/about');
	} else {
		req.flash('error', "Username or password incorrect.");
		res.redirect('/');
	}
});

app.get('/about', function(req, res) {
	res.render('aboutcompany.ejs', {
		user: req.session.user
	});
});

app.get('/analyze', function(req,res) {
	res.render('analyze.ejs', {
		user: req.session.user
	});
});

var port = Number(process.env.PORT || 8001);
app.listen(port);
console.log("Listening on port " + port);


// Helper functions
var createUser = function(user, callback) {
	// First we need to login to the REST API as an admin.
	var loginxml = new XMLWriter();
	loginxml.startElement('tsRequest').startElement('credentials').writeAttribute('name', 'admin')
		.writeAttribute('password', 'admin').startElement('site').writeAttribute('contentUrl', '');
	request.post( 
		{
			url: 'http://mkovner-vm/api/2.0/auth/signin',
			body: loginxml.toString(),
			headers: {'Content-Type': 'text/xml'}
		},
		// Express requests take a 'callback' function which will be called when the request has been processed. The
		// response from the server will be contained in the 3rd parameter 'body'.
		function(err, response, body) {
			if(err) {
				callback(err);
				return;
			} else {
				// In order to grab information from the response, we turn it into an xml object and use a module
				// called node-jsxml to parse the xml. node-jsxml allows us to use child(), attribute(), and some other functions
				// to locate specific elements and pieces of information that we need.
				// Here, we need to grab the 'token' attribute and store it in the session cookie.
				var authXML = new jsxml.XML(body);
				var authToken = authXML.child('credentials').attribute("token").getValue();
				console.log("Auth token: " + authToken);
				// OK We're logged in, but we have one more step, grabbing the luid for the site we want to
				// add our user to.
				request(
					{
						url: 'http://mkovner-vm/api/2.0/sites/rest?key=name',
						headers: {
							'Content-Type': 'text/xml',
							'X-Tableau-Auth': authToken
						}
					},

					function(err, response, body) {
						if(err) {
							callback(err);
							return;
						} else {
							var siteXML = new jsxml.XML(body);
							var siteID = siteXML.child('site').attribute("id").getValue();
							console.log("site id: " + siteID);
						}
						// OK. we have the site id and the auth token. We have all the pieces to make the
						// post request to add the user.

						//First, build the XML for the POST
						var userxml = new XMLWriter();
						userxml.startElement('tsRequest').startElement('user')
							.writeAttribute('name', user).writeAttribute('role', 'Interactor')
							.writeAttribute('publish', 'true').writeAttribute('contentAdmin','false')
							.writeAttribute('suppressGettingStarted', 'true');
						request.post( 
							{
								url: 'http://mkovner-vm/api/2.0/sites/' + siteID + '/users/',
								body: userxml.toString(),
								headers: {
									'Content-Type': 'text/xml',
									'X-Tableau-Auth': authToken
								}
							},
							function(err, response, body) {
								if(err) {
									callback(err);
									return;
								} else {
									//If the request was succesful we get xml back that contains the id and name of the added user.
									var newUserXML = new jsxml.XML(body);
									console.log(newUserXML.toString());
									var userID = newUserXML.child('user').attribute('id').getValue();
									var userName = newUserXML.child('user').attribute('name').getValue();
									console.log(userName + " added with user id " + userID);
								}
								callback(null);
								return;
							}
						);	
					}
				);
			}
		}
	);	
}