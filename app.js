'use strict'

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
var requestify = require('requestify');
var fs = require('fs');
var jsonfile = require('jsonfile');
var knowledgeFile = 'knowledge.json';

//NLP library
var natural = require("natural");
var tokenizer = new natural.WordTokenizer();
var regExpToke = new natural.RegexpTokenizer();
var wordPuncToke = new natural.WordPunctTokenizer();
//WTF engine for random responses
var wtf = require('./scripts/wtf');
var main = require('./scripts/main');

var text = fs.readFileSync('text.txt', 'utf-8');
var corpus = tokenizer.tokenize(text);
var spellcheck = new natural.Spellcheck(corpus);

//Global variables
var tokenisedText;
var fixedString;
var myval;
var matchedQuery;
var getParking;
var returnedBikeOrPark;
var returnedQuery;
var btnChoice;
var pin;
var lookForBikesSpaces;
var previousStationName;
var catchSentc;
var WTFswitch;

// recommended to inject access tokens as environmental variables
const token = process.env.FB_PAGE_ACCESS_TOKEN;
const gMapsPath = process.env.GOOGLE_MAPS_PATH;
const gMapsPng = process.env.GOOGLE_MAPS_PNG;
const hubToke = process.env.FB_HUB_TOKE;

app.set('port', (process.env.PORT || 5000))

// parse application/x-www-form-urlencode
app.use(bodyParser.urlencoded({extended: false}))

// parse application/json
app.use(bodyParser.json())

app.get('/', function (req, res) {
	res.send("Welcome to BikeBot")
})

// for facebook verification
app.get('/webhook/', function (req, res) {
	if (req.query['hub.verify_token'] === hubToke) {
		res.send(req.query['hub.challenge'])
	}
	res.send('Error, wrong token')
})

app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object === 'page') {

    // Iterate over each entry - there may be multiple if batched
    data.entry.forEach(function(entry) {
      var pageID = entry.id;
      var timeOfEvent = entry.time;

      // Iterate over each messaging event
      entry.messaging.forEach(function(event) {
        if (event.message) {
          receivedMessage(event);
        }
        if(event.postback){
          catchSentc = false;
          receivedPostback(event);
        }
          else {
          console.log("Webhook received unknown event: ", event);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know
    // you've successfully received the callback. Otherwise, the request
    // will time out and we will keep trying to resend.
    res.sendStatus(200);
  }
});

function receivedMessage(event, callback) {
  var sender = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;
  var lat;
  var lng;

  console.log("Received message for user %d and page %d at %d with message:",
    sender, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var messageId = message.mid;
  var messageText = message.text;
  var messageAttachments = message.attachments;

  if(messageAttachments){
      catchSentc = false;
      var attachment = event.message.attachments[0];

      if(attachment.type === 'location'){
          lat = event.message.attachments[0].payload.coordinates.lat;
          lng = event.message.attachments[0].payload.coordinates.long;
          if(pin == true){
              if(btnChoice == 'bike'){
                 pin = false;
                 howDoIgetthereBike(sender, lat,lng, previousStationName);
              }
              else if(btnChoice == 'park'){
                 pin = false;
                 howDoIgettherePark(sender, lat,lng, previousStationName);
              }
          }
          else if(btnChoice == 'bike'){
              findClosestFreeBike(sender,lat,lng);
            }
          else if(btnChoice == 'park'){
              findClosestFreeSpace(sender,lat,lng);
          }
      }
      else{
          console.log("Attachment type: " + attachment.type);
      }
  }
  if (messageText) {
        catchSentc = false;
        WTFswitch = false;
        tokenisedText = tokeniseUserSentence(messageText);
        fixedString = spellChecker(tokenisedText);
        matchedQuery = readKnowledgeBase(sender, fixedString);

        if(WTFswitch != false){
            WTFresponse(sender);
        }

        else if (matchedQuery != null) {
            catchSentc = true;
            firstPrompt(sender, matchedQuery);
        }

        else if(fixedString.indexOf('park') > -1){
            catchSentc = true;
            btnChoice = 'park';
            lookForBikesSpaces = true;
            askForLocation(sender);
        }

        else if (fixedString.indexOf('bike') > -1) {
            catchSentc = true;
            btnChoice = 'bike';
            lookForBikesSpaces = true;
            askForLocation(sender);
        }

        else if (fixedString.indexOf('How') > -1) {
            pin = true;
            howDoIgetThere(sender);
        }

        else if(lookForBikesSpaces == true){
            getBikesSpaces(sender, fixedString);
        }
    }
}


//Tokeniser for the user's input
function tokeniseUserSentence(toke) {
    //var foo = regExpToke.tokenize(toke);
    var tokenisedText = wordPuncToke.tokenize(toke);
    console.log("TOKENIZED : " + tokenisedText);
    return tokenisedText;
}

//Spellcheck the users sentence and reconstruct string
function spellChecker(tokenisedText){

    var ex = tokenisedText;
    var fixedString = '';

    for(var t = 0; t < ex.length; t++){

        var check = spellcheck.getCorrections(ex[t], 1)[0];
        var dist = 0;
        if(check){
            dist = natural.JaroWinklerDistance(check, ex[t]);
        }
        //console.log('dist' + dist);
        if(dist > 0.8){
            fixedString += check + " ";
        }else{
            fixedString += ex[t] + " ";
        }

    }
    console.log("FIXED STRING: " + fixedString);
    return fixedString;

}

//WTF engine for creating a random response
function WTFresponse(sender){
    var WTF = wtf.test();
    var WTFSentence =  WTF.generate();
    firstPrompt(sender, WTFSentence);
}

//Keyword matching function
function readKnowledgeBase(sender, messageText){

    var question;
    var answer;
    var res2;
    var data;
    var obj;

    var content = fs.readFileSync("knowledge.json");
    var obj = JSON.parse(content);

    for(var t = 0; t<obj.knowledge.length; t++){

        question = obj.knowledge[t].Q;
        answer = obj.knowledge[t].A;

        res2 = messageText.match(question);

        if( res2 == "Hello" || res2 == "Hi" || res2 == "Hey"){
            WTFswitch = true;
            matchedQuery = null;
            break;
        }
        else if( res2 == question){
            catchSentc = true;
            matchedQuery = answer;
            break;
        }
        else{
            matchedQuery = null;
        }
    }

    return matchedQuery;
}

//Retrieves how many free bikes or Spaces are available at the given location
function getBikesSpaces(sender, messageText){

    var y = messageText;
    console.log("Texted passed to find bike: " + y);
    //Makes all the first letters of the tokenised sentence upper case
    var upperCase = messageText.replace(/\w\S*/g, function(txt)
                                          {return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});

    requestify.get('http://api.citybik.es/v2/networks/dublinbikes').then(function(response) {
        // Get the response body
        response.getBody();

        // Get the response raw body
        response.body;
        var data = response.body;
        var obj = JSON.parse(data);
        //var returnedQuery;

        for(var i = 0; i<101; i++){

            var station = obj.network.stations[i].extra.address;
            var bikes = obj.network.stations[i].free_bikes;
            var spaces = obj.network.stations[i].empty_slots;
            var res = upperCase.match(station);

            if(btnChoice == 'bike'){
                if(station == res){
                    previousStationName = station;
                    var wantedStation = station;
                    var freebikes = bikes;
                    if(freebikes == '0'){
                        returnedQuery = "There are no free bikes available at the " + wantedStation + " station";
                        emptyResultAskForLocation(sender, returnedQuery);
                        catchSentc = true;
                        break;
                    }
                    else if(freebikes == '1'){
                        returnedQuery = "There is " + freebikes + " free bike at the " + wantedStation + " station";
                        sendTextMessage(sender, returnedQuery);
                        catchSentc = true;
                        break;
                    }
                    else{
                        returnedQuery = "There are " + freebikes + " free bikes at the " + wantedStation + " station";
                        sendTextMessage(sender, returnedQuery);
                        catchSentc = true;
                        break;
                    }
                }
            }
            if(btnChoice == 'park'){
                if(station == res){
                    previousStationName = station;
                    var wantedStation = station;
                    var freeSpaces = spaces;
                    if(freeSpaces == '0'){
                        returnedQuery = "There are no free slots available at the " + wantedStation + " station";
                        emptyResultAskForLocation(sender, returnedQuery);
                        catchSentc = true;
                        break;
                    }
                    else if(freeSpaces == '1'){
                        returnedQuery = "There is " + freeSpaces + " free slots at the " + wantedStation + " station";
                        sendTextMessage(sender, returnedQuery);
                        catchSentc = true;
                        break;
                    }
                    else{
                        returnedQuery = "There are " + freeSpaces + " free slots at the " + wantedStation + " station";
                        sendTextMessage(sender, returnedQuery);
                        catchSentc = true;
                        break;
                    }
                }
            }
            else{
                catchSentc = false;
                }
            }

            if(catchSentc != true){
                firstPrompt(sender, "Sorry I didnt quite understand you!");
            }

        }

    );

}

//Sends a quick reply with the option of sending back the users location
function askForLocation(recipientId , val) {
    let messageData = {
    "recipient":{
    "id": recipientId
    },
      "message":{
        "text":"Share your location or type the name of the street you are looking for?",
        "quick_replies":[
          {
            "content_type":"location",
          }
        ]
      }
    };

    callSendAPI(messageData);
}

//Sends a quick reply with the option of sending back the users location after a 0 return of bikes or spaces
function emptyResultAskForLocation(recipientId , val) {
    let messageData = {
    "recipient":{
    "id": recipientId
    },
      "message":{
        "text": val + " Share your location or type a different street to check for more availability?",
        "quick_replies":[
          {
            "content_type":"location",
          }
        ]
      }
    };

    callSendAPI(messageData);
}

//Find location to the bike from previous sentence
function howDoIgetThere(recipientId) {

    let messageData = {
    "recipient":{
    "id": recipientId
    },
      "message":{
        "text":"Share your location?",
        "quick_replies":[
          {
            "content_type":"location",
          }
        ]
      }
    };

    callSendAPI(messageData);
}

//Finds lat and lng to station and user for a bike
function howDoIgetthereBike(sender,lat, lng, previousStationName){

    var closestStation;
    var closestStationLat;
    var closestStationLng;
    var free;

    //Sends typing bubbles to show the user the app is working on the query
    senderBubble(sender);

    requestify.get('http://api.citybik.es/v2/networks/dublinbikes').then(function(response) {
        // Get the response body
        response.getBody();

        // Get the response raw body
        response.body;
        var data = response.body;
        var obj = JSON.parse(data);

        for(var i = 0; i<101; i++){

            var lat2 = obj.network.stations[i].latitude;
            var lon2 = obj.network.stations[i].longitude;
            var station = obj.network.stations[i].extra.address;

            if(station == previousStationName){
                closestStation = obj.network.stations[i].extra.address;
                closestStationLat = obj.network.stations[i].latitude;
                closestStationLng = obj.network.stations[i].longitude;
                free = obj.network.stations[i].free_bikes;
            }
        }

        pointsForBikePath2(sender, lat, lng, closestStationLat,
                                closestStationLng, closestStation, free);

    });

}

//FInds lat and lng to the station and user for parking
function howDoIgettherePark(sender,lat, lng, previousStationName){

    var closestStation;
    var closestStationLat;
    var closestStationLng;
    var freeSpace;

    //Sends typing bubbles to show the user the app is working on the query
    senderBubble(sender);

    requestify.get('http://api.citybik.es/v2/networks/dublinbikes').then(function(response) {
        // Get the response body
        response.getBody();

        // Get the response raw body
        response.body;
        var data = response.body;
        var obj = JSON.parse(data);

        for(var i = 0; i<101; i++){

            var lat2 = obj.network.stations[i].latitude;
            var lon2 = obj.network.stations[i].longitude;
            var station = obj.network.stations[i].extra.address;

            if(station == previousStationName){
                closestStation = obj.network.stations[i].extra.address;
                closestStationLat = obj.network.stations[i].latitude;
                closestStationLng = obj.network.stations[i].longitude;
                freeSpace = obj.network.stations[i].empty_slots;
            }
        }

        pointsForParkingPath2(sender, lat, lng, closestStationLat,
                                closestStationLng, closestStation, freeSpace);

    });

}

//Algorithm to find the closet free bikes to users location
function findClosestFreeBike(sender,lat, lng, callback) {

    var pi = Math.PI;
    var R = 6371; //equatorial radius
    var distances = {};
    var closest = -1;
    var closestStation;
    var closestStationLat;
    var closestStationLng;
    var free;
    var freeB = [];
    var val, val2;

    //Sends typing bubbles to show the user the app is working on the query
    senderBubble(sender);

    requestify.get('http://api.citybik.es/v2/networks/dublinbikes').then(function(response) {
        // Get the response body
        response.getBody();

        // Get the response raw body
        response.body;
        var data = response.body;
        var obj = JSON.parse(data);

        for(var i = 0; i<101; i++){

            var lat2 = obj.network.stations[i].latitude;
            var lon2 = obj.network.stations[i].longitude;
            var name = obj.network.stations[i].extra.address;
            freeB.push(obj.network.stations[i].free_bikes);

            var chLat = lat2-lat;
            var chLon = lon2-lng;

            var dLat = chLat*(pi/180);
            var dLon = chLon*(pi/180);

            var rLat1 = lat*(pi/180);
            var rLat2 = lat2*(pi/180);

            var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                        Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(rLat1) * Math.cos(rLat2);
            var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            var d = R * c;

            distances[i] = {dist: d , street: name};

            if(freeB[i] != '0'){
                if ( closest == -1 || d < distances[closest].dist) {
                    closest = i;
                    closestStation = obj.network.stations[closest].extra.address;
                    free = obj.network.stations[closest].free_bikes;
                    closestStationLat = obj.network.stations[closest].latitude;
                    closestStationLng = obj.network.stations[closest].longitude;
                }
            }
        }

        //sort distance's and return second and third station for extra options
        var sortable = [];
        for (var i in distances)
            sortable.push([distances[i].street, distances[i].dist])

        sortable.sort(function(a, b) {
            return a[1] - b[1]
        })

        val = sortable[1][0];
        val2 = sortable[2][0];

        pointsForBikePath(sender, lat, lng, closestStationLat,
                                closestStationLng, closestStation, free, val, val2);
    });

}

//Algorithm to find the closet free parking spaces to users location
function findClosestFreeSpace(sender,lat, lng) {
    var pi = Math.PI;
    var R = 6371; //equatorial radius
    var distances = {};
    var closest = -1;
    var closestStation;
    var closestStationLat;
    var closestStationLng;
    var freeSpace;
    var freeSpaceB = [];
    var val, val2;

    //Sends typing bubbles to show the user the app is working on the query
    senderBubble(sender);

    requestify.get('http://api.citybik.es/v2/networks/dublinbikes').then(function(response) {
        // Get the response body
        response.getBody();

        // Get the response raw body
        response.body;
        var data = response.body;
        var obj = JSON.parse(data);

        for(var i = 0; i<101; i++){

            var lat2 = obj.network.stations[i].latitude;
            var lon2 = obj.network.stations[i].longitude;
            var name = obj.network.stations[i].extra.address;
            freeSpaceB[i] = obj.network.stations[i].empty_slots;

            var chLat = lat2-lat;
            var chLon = lon2-lng;

            var dLat = chLat*(pi/180);
            var dLon = chLon*(pi/180);

            var rLat1 = lat*(pi/180);
            var rLat2 = lat2*(pi/180);

            var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                        Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(rLat1) * Math.cos(rLat2);
            var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            var d = R * c;

            distances[i] = {dist: d , street: name};

            if(freeSpaceB[i] != '0'){
                if ( closest == -1 || d < distances[closest].dist) {
                    closest = i;
                    closestStation = obj.network.stations[closest].extra.address;
                    freeSpace = obj.network.stations[closest].empty_slots;
                    closestStationLat = obj.network.stations[closest].latitude;
                    closestStationLng = obj.network.stations[closest].longitude;
                }
            }
        }

        //sort distance's and return second and third station for extra options
        var sortable = [];
        for (var i in distances)
            sortable.push([distances[i].street, distances[i].dist])

        sortable.sort(function(a, b) {
            return a[1] - b[1]
        })

        val = sortable[1][0];
        val2 = sortable[2][0];

        pointsForParkingPath(sender, lat, lng, closestStationLat,closestStationLng,
                             closestStation, freeSpace, val, val2);
    });

}

//Gets the data to draw the polyline between two points on google maps for bikes
function pointsForBikePath(sender, lat, lng, lat2, lng2, closeStation, free, val, val2){

    requestify.get("https://maps.googleapis.com/maps/api/directions/json?origin="+lat+","+lng+"&destination="+lat2+","+lng2+"&mode=walking&key= "+gMapsPath).then(function(response){

        response.body;
        var data = response.body;
        var obj = JSON.parse(data);

        var polyline = obj.routes[0].overview_polyline.points;
        var distance = obj.routes[0].legs[0].distance.text;
        var time = obj.routes[0].legs[0].duration.text;
        staticMapOpt(sender, lat, lng, lat2, lng2, polyline, closeStation, free,
                  distance, time, val, val2);

    });
}

//Gets the data to draw the polyline between two points on google maps for bikes
function pointsForBikePath2(sender, lat, lng, lat2, lng2, closeStation, free){

    requestify.get("https://maps.googleapis.com/maps/api/directions/json?origin="+lat+","+lng+"&destination="+lat2+","+lng2+"&mode=walking&key= "+gMapsPath).then(function(response){

        response.body;
        var data = response.body;
        var obj = JSON.parse(data);

        var polyline = obj.routes[0].overview_polyline.points;
        var distance = obj.routes[0].legs[0].distance.text;
        var time = obj.routes[0].legs[0].duration.text;
        staticMap(sender, lat, lng, lat2, lng2, polyline, closeStation, free,
                  distance, time);

    });
}

//Gets the data to draw the polyline between two points on google maps for spaces
function pointsForParkingPath(sender, lat, lng, lat2, lng2, closeStation, freeSpaces, val, val2){
    requestify.get("https://maps.googleapis.com/maps/api/directions/json?origin="+lat+","
                   +lng+"&destination="+lat2+","+lng2+"&mode=cycling&key= "+gMapsPath).then(function(response){

        response.body;
        var data = response.body;
        var obj = JSON.parse(data);

        var polyline = obj.routes[0].overview_polyline.points;
        var distance = obj.routes[0].legs[0].distance.text;
        var time = obj.routes[0].legs[0].duration.text;
        staticMapSpaceOpt(sender, lat, lng, lat2, lng2, polyline, closeStation,
                        freeSpaces, distance, time, val, val2);

    });
}

//Gets the data to draw the polyline between two points on google maps for spaces
function pointsForParkingPath2(sender, lat, lng, lat2, lng2, closeStation, freeSpaces){

    requestify.get("https://maps.googleapis.com/maps/api/directions/json?origin="+lat+","
                   +lng+"&destination="+lat2+","+lng2+"&mode=cycling&key= "+gMapsPath).then(function(response){

        response.body;
        var data = response.body;
        var obj = JSON.parse(data);

        var polyline = obj.routes[0].overview_polyline.points;
        var distance = obj.routes[0].legs[0].distance.text;
        var time = obj.routes[0].legs[0].duration.text;
        staticMapSpace(sender, lat, lng, lat2, lng2, polyline, closeStation,
                        freeSpaces, distance, time);

    });
}

//Gets a Google Static Map to show user location and closet station with bikes
function staticMap(sender, lat, lng, lat2, lng2, polyline, closeStation, free, distance, time){

    var messageData = {
    recipient: {
      id: sender
    },
    "message":{
    "attachment":{
      "type":"template",
      "payload":{
          "template_type": "generic",
                "elements": {
                    "element": {
                        "title": "Nearest station is " + closeStation,
                        "subtitle":"There are " + free + " bikes available" + "\n" + "Distance: " + distance + "\n" + "Walking: " + time,
                        "image_url":'https://maps.googleapis.com/maps/api/staticmap?center='+ lat + ',' + lng +'&size=640x450&maptype=roadmap&markers='+ lat + ',' + lng +'|'+ lat2 +',' + lng2 + '&path=weight:3%7Ccolor:blue%7Cenc:'+polyline+'&key='+ gMapsPng,
                        "item_url": 'https://maps.googleapis.com/maps/api/staticmap?center='+ lat + ',' + lng +'&size=640x450&maptype=roadmap&markers='+ lat + ',' + lng +'|'+ lat2 +',' + lng2 + '&path=weight:3%7Ccolor:blue%7Cenc:'+polyline+'&key=' + gMapsPng
                    }
                }
            }
        }
      }
    };

    callSendAPI(messageData);

}

//Gets a Google Static Map to show user location and closet station with bikes with extra options
function staticMapOpt(sender, lat, lng, lat2, lng2, polyline, closeStation, free, distance, time, val, val2){

    var messageData = {
    "recipient":{
    "id": sender
      },
      "message":{
        "attachment":{
          "type":"template",
          "payload":{
            "template_type":"generic",
            "elements":[
               {
                "title": "Nearest station is " + closeStation,
                "subtitle":"There are " + free + " bikes available" + "\n" + "Distance: " + distance + "\n" + "Walking: " + time,
                "image_url":'https://maps.googleapis.com/maps/api/staticmap?center='+ lat + ',' + lng +'&size=640x450&maptype=roadmap&markers='+ lat + ',' + lng +'|'+ lat2 +',' + lng2 + '&path=weight:3%7Ccolor:blue%7Cenc:'+polyline+'&key='+ gMapsPng,
                "item_url": 'https://maps.googleapis.com/maps/api/staticmap?center='+ lat + ',' + lng +'&size=640x450&maptype=roadmap&markers='+ lat + ',' + lng +'|'+ lat2 +',' + lng2 + '&path=weight:3%7Ccolor:blue%7Cenc:'+polyline+'&key=' + gMapsPng,
                "buttons":[
                  {
                    "type":"postback",
                    "title": "" + val,
                    "payload": "" +val
                  },
                    {
                    "type":"postback",
                    "title": "" + val2,
                    "payload": "" + val2
                  }
                ],
              }
            ]
          }
        }
      }
    };

    callSendAPI(messageData);

}

//Gets a Google Static Map to show user location and closet station with parking spaces
function staticMapSpace(sender, lat, lng, lat2, lng2, polyline, closeStation, freeSpace, distance, time){

    var messageData = {
    recipient: {
      id: sender
    },
    "message":{
    "attachment":{
      "type":"template",
      "payload":{
          "template_type": "generic",
                "elements": {
                    "element": {
                        "title": "Nearest station is " + closeStation,
                        "subtitle":"There are " + freeSpace + " spaces available" + "\n" + "Distance: " + distance + "\n" + "Cycling: " + time,
                        "image_url":'https://maps.googleapis.com/maps/api/staticmap?center='+ lat + ',' + lng +'&size=640x450&maptype=roadmap&markers='+ lat + ',' + lng +'|'+ lat2 +',' + lng2 + '&path=weight:3%7Ccolor:blue%7Cenc:'+polyline+'&key=' + gMapsPng,
                        "item_url": 'https://maps.googleapis.com/maps/api/staticmap?center='+ lat + ',' + lng +'&size=640x450&maptype=roadmap&markers='+ lat + ',' + lng +'|'+ lat2 +',' + lng2 + '&path=weight:3%7Ccolor:blue%7Cenc:'+polyline+'&key=' + gMapsPng
                    }
                }
            }
        }
      }
    };
    callSendAPI(messageData);

}

//Gets a Google Static Map to show user location and closet station with parking spaces with extra options
function staticMapSpaceOpt(sender, lat, lng, lat2, lng2, polyline, closeStation, freeSpace, distance, time, val, val2){

    var messageData = {
    "recipient":{
    "id": sender
      },
      "message":{
        "attachment":{
          "type":"template",
          "payload":{
            "template_type":"generic",
            "elements":[
               {
                "title": "Availability at " + closeStation,
                "subtitle":"There are " + freeSpace + " spaces available" + "\n" + "Distance: " + distance + "\n" + "Cycling: " + time,
                "image_url":'https://maps.googleapis.com/maps/api/staticmap?center='+ lat + ',' + lng +'&size=640x450&maptype=roadmap&markers='+ lat + ',' + lng +'|'+ lat2 +',' + lng2 + '&path=weight:3%7Ccolor:blue%7Cenc:'+polyline+'&key=' + gMapsPng,
                "item_url": 'https://maps.googleapis.com/maps/api/staticmap?center='+ lat + ',' + lng +'&size=640x450&maptype=roadmap&markers='+ lat + ',' + lng +'|'+ lat2 +',' + lng2 + '&path=weight:3%7Ccolor:blue%7Cenc:'+polyline+'&key=' + gMapsPng,
                "buttons":[
                  {
                    "type":"postback",
                    "title": "" + val,
                    "payload": "" +val
                  },
                    {
                    "type":"postback",
                    "title": "" + val2,
                    "payload": "" + val2
                  }
                ],
              }
            ]
          }
        }
      }
    };
    callSendAPI(messageData);

}

//The first promt to the user to see if they want a bike or a parking space
function firstPrompt(sender, matchedQuery) {
    let messageData = {
        "recipient":{
        "id": sender
      },
      "message":{
        "text": matchedQuery + " Which of the following can I find for you?",
        "quick_replies":[
          {
            "content_type":"text",
            "title":"bike",
            "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_RED"
          },
          {
            "content_type":"text",
            "title":"park",
            "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_GREEN"
          }
        ]
      }
    };

	callSendAPI(messageData);

}

//Sends a a typing bubble to show the user that the app is processing the query
function senderBubble(recipientId){

    var messageData = {
        "recipient":{
            "id":recipientId
        },
        "sender_action":"typing_on"
    };

    callSendAPI(messageData);
}

//Construct text message to send
function sendTextMessage(recipientId, myval) {

  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: myval
    }
  };

  callSendAPI(messageData);
}

//Sends message to API
function callSendAPI(messageData) {

	request({
		url: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {access_token:token},
		method: 'POST',
		json: messageData

	},
        function(error, response, body) {
		if (error) {
			console.log('Error sending messages: ', error)
		} else if (response.body.error) {
			console.log('Error: ', response.body.error)
		}
	});
}

//Need to work on the Callbacks!
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);

  // When a postback is called, we'll send the payload to function to search for bikes or stations
  getBikesSpaces(senderID, payload);

}

app.listen(app.get('port'), function() {
	console.log('running on port', app.get('port'))
})

