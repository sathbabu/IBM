const archiver = require( 'archiver-promise' );
const async = require( 'async' );
const AWS = require( 'ibm-cos-sdk' );
const Excel = require( 'exceljs' );
const fs = require( 'fs' );  
const jsonfile = require( 'jsonfile' );
const mysql = require( 'mysql' );
const util = require( 'util' );

let params = jsonfile.readFileSync( __dirname + '/config.json' );
params.id = '5c346753-367b-43eb-af77-1623093eae52';

report();

async function report() {
  let start = null;
  let end = null;

  // Query date
  let year = 0;
  let month = 0;
  let last = 0;

  // Right now
  const now = new Date();

  // Year
  if( params.year ) {
    year = parseInt( params.year );
  } else {
    year = now.getFullYear();
  }

  // Month
  if( params.month ) {
    // Let user use one-based month
    // Map to zero-based JavaScript
    month = parseInt( params.month - 1 );
  } else {
    month = now.getMonth();
  }

  // Last day of month
  // https://stackoverflow.com/questions/222309
  last = new Date( year, month + 1, 0 ).getDate();

  // Formalize
  // For use in query
  if( params.month || params.year ) {
    start = new Date( year, month, 1 );
    end = new Date( year, month, last );
  } else {
    start = new Date( year, month, now.getDate() );
    start.setDate( start.getDate() - 30 );
    end = new Date( year, month, now.getDate() );
  }

  console.log( start );
  console.log( end );

  let cos = new AWS.S3( {
    endpoint: params.COS_ENDPOINT,
    apiKeyId: params.COS_API_KEY,
    ibmAuthEndpoint: params.COS_AUTH_ENDPOINT,
    serviceInstanceId: params.COS_SERVICE_INSTANCE
  } );

  let item = await cos.getObject( {
    Bucket: params.COS_BUCKET, 
    Key: `${params.id}.zip`
  } )
  .promise()
  .then( (data ) => {
      return data;
  } )
  .catch( ( e ) => {
    console.log( `ERROR: ${e.code} - ${e.message}` );
  } );

  if( item != null ) {
    last = new Date( item.LastModified );
    let today = new Date();
  
    if( ( today.getTime() - last.getTime() ) <= ( 24 * 3600 * 1000 ) ) {
      console.log( 'Using current archive.' );
      return Buffer.from( item.Body ).toString( 'base64' );
    }
  }

  // Connect to MySQL
  // Compose
  const connection = mysql.createConnection( {
    host: params.MYSQL_HOST,
    port: params.MYSQL_PORT,
    user: params.MYSQL_USER,
    password: params.MYSQL_PASSWORD,
    ssl: {
      ca: fs.readFileSync( __dirname + '/' + params.MYSQL_CERTIFICATE )
    },
    database: params.MYSQL_DATABASE
  } );

  connection.connect();

  const query = util.promisify( connection.query ).bind( connection );

  let organization = await query( 'SELECT * FROM Organization WHERE uuid = ?', params.id );
  console.log( organization[0].id + ' (' + params.id + ')' );

  let techs = await query( 'SELECT * FROM Technology' );

  let posts = await query( 
    'SELECT ' +
    'Advocate.email, ' +
    'Post.published_at, ' +
    'Post.title, ' +
    'Post.link, ' +
    'Post.category, ' +
    'Post.keywords ' +
    'FROM Advocate, Blog, Organization, Post, Team ' +
    'WHERE Post.blog_id = Blog.id ' +
    'AND Blog.advocate_id = Advocate.id ' +
    'AND Advocate.team_id = Team.id ' +
    'AND Team.organization_id = Organization.id ' +
    'AND Organization.id = ? ' +
    'AND Post.published_at >= ? ' +
    'AND Post.published_at <= ? ' +
    'ORDER BY Post.published_at',
    [organization[0].id, start, end]
  );

  let events = await query(
    'SELECT ' +
    'Event.starts_at, ' +
    'Meetup.city, ' +
    'Event.name, ' +
    'Event.description, ' +
    'Event.link, ' +
    'Event.maximum, ' +
    'Event.rsvp, ' +
    'Event.waitlist ' +
    'FROM Event, Meetup ' +
    'WHERE Event.meetup_id = Meetup.id ' +
    'AND Event.starts_at >= ? ' +
    'AND Event.starts_at <= ? ' +
    'ORDER BY Event.starts_at',
    [start, end]
  );

  let status = await query(
    'SELECT ' +
    'Advocate.email, ' +
    'Status.published_at, ' +
    'Status.text, ' +
    'Status.link, ' +
    'Status.favorite, ' +
    'Status.retweet, ' +
    'Status.hashtags, ' +
    'Status.mentions ' +
    'FROM Advocate, Organization, Status, Team, Twitter ' +
    'WHERE Status.twitter_id = Twitter.id ' +
    'AND Twitter.advocate_id = Advocate.id ' +
    'AND Advocate.team_id = Team.id ' +
    'AND Team.organization_id = Organization.id ' +
    'AND Organization.id = ? ' +
    'AND Status.published_at >= ? ' +
    'AND Status.published_at <= ? ' +
    'ORDER BY Status.published_at',
    [organization[0].id, start, end]
  );

  let videos = await query(
    'SELECT ' +
    'Advocate.email, ' +
    'Video.published_at, ' +
    'Video.title, ' +
    'Video.link, ' +
    'Video.views, ' +
    'Video.stars, ' +
    'Video.duration, ' +
    'Video.summary ' +
    'FROM Advocate, Organization, Team, Video, YouTube ' +
    'WHERE Video.youtube_id = YouTube.id ' +
    'AND YouTube.advocate_id = Advocate.id ' +
    'AND Advocate.team_id = Team.id ' +
    'AND Team.organization_id = Organization.id ' +
    'AND Organization.id = ? ' +
    'AND Video.published_at >= ? ' +
    'AND Video.published_at <= ? ' +
    'ORDER BY Video.published_at',
    [organization[0].id, start, end]
  );

  let answers = await query(
    'SELECT ' +
    'Advocate.email, ' +
    'Answer.answered_at, ' +
    'Answer.link, ' +
    'Answer.title, ' +    
    'Answer.score, ' +
    'Answer.accepted, ' +    
    'Answer.tags, ' +
    'Answer.keywords ' +
    'FROM Advocate, Answer, Organization, StackOverflow, Team ' +
    'WHERE Answer.so_id = StackOverflow.id ' +
    'AND StackOverflow.advocate_id = Advocate.id ' +
    'AND Advocate.team_id = Team.id ' +
    'AND Team.organization_id = Organization.id ' +
    'AND Organization.id = ? ' +
    'AND Answer.answered_at >= ? ' +
    'AND Answer.answered_at <= ? ' +
    'ORDER BY Answer.answered_at',
    [organization[0].id, start, end]
  );  

  connection.end();  

  let output = fs.createWriteStream( __dirname + '/' + params.id + '.zip' );  
  
  let archive = archiver( 'zip', {
    gzip: true,
    zlib: {level: 9}
  } );  
  archive.pipe( output );

  for( let t = 0; t < techs.length; t++ ) {
    console.log( techs[t].name );

    let workbook = new Excel.Workbook();
    await workbook.xlsx.readFile( __dirname + '/template.xlsx' );

    techs[t].keywords = techs[t].keywords.split( ',' ); 

    let sheet = workbook.getWorksheet( 'Blog' );
    fill( 
      sheet,
      techs[t], 
      posts, 
      ['title', 'category', 'keywords'],
      [' ', ',', ','],
      ['email', 'published_at', 'title', 'link', 'category', 'keywords']
    );

    sheet = workbook.getWorksheet( 'Twitter' );
    fill( 
      sheet,
      techs[t], 
      status, 
      ['text', 'hashtags', 'mentions'],
      [' ', ',', ','],
      ['email', 'published_at', 'text', 'link', 'favorite', 'retweet', 'hashtags', 'mentions']
    );    

    sheet = workbook.getWorksheet( 'YouTube' );
    fill( 
      sheet,
      techs[t], 
      videos, 
      ['title', 'summary'],
      [' ', ' '],
      ['email', 'published_at', 'title', 'link', 'stars', 'views', 'duration', 'summary']
    );        

    sheet = workbook.getWorksheet( 'Stack Overflow' );
    fill( 
      sheet,
      techs[t], 
      answers, 
      ['title', 'tags', 'keywords'],
      [' ', ',', ','],
      ['email', 'answered_at', 'link', 'title', 'score', 'accepted', 'tags', 'keywords']
    );            

    sheet = workbook.getWorksheet( 'Meetups' );
    fill( 
      sheet,
      techs[t], 
      events, 
      ['name', 'description'],
      [' ', ' '],
      ['city', 'starts_at', 'name', 'link', 'maximum', 'rsvp', 'waitlist']
    );                

    await workbook.xlsx.writeFile( __dirname + '/output/' + techs[t].file + '.xlsx' );

    archive.file( 
      __dirname + '/output/' + techs[t].file + '.xlsx',
      {name: techs[t].file + '.xlsx'}
    );
  }

  await archive.finalize();    

  // await upload( cos, params.COS_BUCKET, params.id );
  let obj = fs.readFileSync( params.id + '.zip' );

  await cos.putObject( {
    Body: obj,
    Bucket: params.COS_BUCKET,
    Key: params.id + '.zip'   
  } )
  .promise()
  .then( ( data ) => {
    console.log( 'Upload complete' );
    return data;
  } );

  console.log( 'Done' );
}

function cancel( cos, bucket, item, upload_id ) {
  return cos.abortMultipartUpload( {
    Bucket: bucket,
    Key: item,
    UploadId: upload_id
  } )
  .promise()
  .then(() => {
    console.log( 'Upload aborted.' );
  } )
  .catch( ( e ) => {
    console.error( `ERROR: ${e.code} - ${e.message}\n` );
  } );
}

async function check( cos, bucket, id ) {
  return cos.getObject( {
    Bucket: bucket, 
    Key: `${id}.zip`
  } )
  .promise()
  .then( ( data ) => {
    return data;
  } )
  .catch( ( e ) => {
    console.log( `ERROR: ${e.code} - ${e.message}` );
  } );
}

function fill( sheet, technology, data, split, delimiters, fields ) {
  let row = 2;
  let cols = 'ABCDEFGH';

  for( let d = 0; d < data.length; d++ ) {  
    for( let s = 0; s < split.length; s++ ) {
      if( data[d][split[s]] != null ) {
        data[d][split[s] + '_split'] = data[d][split[s]].toLowerCase().split( delimiters[s] );
      }
    }

    let found = false;

    for( let tech_words = 0; tech_words < technology.keywords.length; tech_words++ ) {
      for( let s = 0; s < split.length; s++ ) {
        if( data[d][split[s]] != null ) {
          for( let data_words = 0; data_words < data[d][split[s] + '_split'].length; data_words++ ) {
            if( technology.keywords[tech_words] == data[d][split[s] + '_split'][data_words].trim() ) {
              found = true;
              break;
            }
          }        
        }
      } 
    }
  
    if( found ) {
      for( let f = 0; f < fields.length; f++ ) {
        let value = '';
  
        if( data[d][fields[f]] != null ) {
          value = data[d][fields[f]];
        }   
  
        sheet.getCell( cols.charAt( f ) + row ).value = value;
      }
  
      row = row + 1;
    }        
  }   
}

async function upload( cos, bucket, id ) {
  let upload_id = null;

  if( !fs.existsSync( `${id}.zip` ) ) {
    console.log( new Error( 'File does not exist.' ) );
    return;
  }

  return cos.createMultipartUpload( {
    Bucket: bucket,
    Key: id + '.zip'
  } )
  .promise()
  .then( ( data ) => {
    upload_id = data.UploadId;

    fs.readFile( id + '.zip', ( e, file_data ) => {
      let part_size = 1024 * 1024 * 5;
      let part_count = Math.ceil( file_data.length / part_size );

      async.timesSeries( part_count, ( part_num, next ) => {
        let start = part_num * part_size;
        let end = Math.min( start + part_size, file_data.length );

        part_num = part_num + 1;

        cos.uploadPart( {
          Body: file_data.slice( start, end ),
          Bucket: bucket,
          Key: id + '.zip',
          PartNumber: part_num,
          UploadId: upload_id
        } )
        .promise()
        .then( ( data ) => {
          next( e, {ETag: data.ETag, PartNumber: part_num} );
        } )
        .catch( ( e ) => {
          cancel( cos, bucket, id + '.zip', upload_id );
          console.log( `ERROR: ${e.code} - ${e.message}\n` );
        } );
      }, ( e, data_packs ) => {
        cos.completeMultipartUpload( {
          Bucket: bucket,
          Key: id + '.zip',
          MultipartUpload: {
            Parts: data_packs
          },
          UploadId: upload_id
        } )
        .promise()
        .then( console.log( 'Upload complete.' ) )
        .catch( ( e ) => {
          cancel( cos, bucket, id + '.zip', upload_id );
          console.error( `ERROR: ${e.code} - ${e.message}\n` );
        } );
      } );
    } );
  } )
  .catch( ( e ) => {
    console.error( `ERROR: ${e.code} - ${e.message}\n` );
  } );
}  
