/*
 * index.js: Import a CFP Excel into Github issue comments for review.
 *
 * (C) 2013, EmpireJS.
 *
 */

var fs = require('fs'),
    path = require('path'),
    util = require('util'),
    async = require('async'),
    xlsxRows = require('xlsx-rows'),
    GitHubApi = require('github');

var importer = module.exports = function (options, callback) {
  options.commentor = 'indexzero';
  options.file = path.join(__dirname, 'empirejs-cfp-2015.xlsx');
  options.repo = 'empirejs/empirejs-cfp-2015';
  options.github = new GitHubApi({
    // required
    version: "3.0.0",
    // optional
    timeout: 5000
  });

  options.github.authenticate({
    type: 'basic',
    username: options.commentor,
    password: process.env.GITHUB_PASS
  });

  async.parallel({
    reviews: async.apply(importer.readReviews, options),
    issues:  async.apply(importer.readIssues, options)
  }, function (err, res) {
    if (err) { return callback(err); }

    //
    // Attach reviews to each issue
    //
    var issues = res.issues.filter(function (issue) {
      var review = res.reviews[issue.title];
      if (!review) { return false; }

      issue.review = review;
      issue.comment = importer.render(review);
      return true;
    });

    console.log('Adding comments for %s issues', issues.length);
    async.forEachLimit(issues, 10, function (issue, next) {
      importer.tryAddComment(options, issue, next);
    }, callback);
  });
};

//
// ### function tryAddComment (options, issue, callback)
// Adds a single comment to the `issue` only if the comment
// from the specified user doesn't already exist.
//
importer.tryAddComment = function (options, issue, callback) {
  var github = options.github;
  importer.readComments(options, issue, function (err, comments) {
    if (err) { return callback(err); }

    var users = comments.map(function (comment) {
      return comment.user.login
    });

    if (~users.indexOf(options.commentor)) {
      console.log('Ignoring comment on #%s, %s', issue.number, issue.title);
      return callback();
    }

    done = true;
    console.log('Adding comment on #%s, %s', issue.number, issue.title);
    github.issues.createComment({
      user: issue.source.user,
      repo: issue.source.repo,
      number: issue.number,
      body: issue.comment
    }, callback);
  });
};

//
// ### function readComments (options, issue, callback)
// Reads comments from the issue.
//
importer.readComments = function (options, issue, callback) {
  var github = options.github;

  github.issues.getComments({
    user: issue.source.user,
    repo: issue.source.repo,
    number: issue.number
  }, function (err, comments) {
    if (err) { return callback(err); }
    return callback(null, comments);
  });
};

//
// ### function readReviews (options, callback)
// Reads all of the existing reviews
//
importer.readReviews = function (options, callback) {
  var rows, reviews;

  try { rows = xlsxRows(options.file); }
  catch (ex) { return callback(ex); }

  reviews = rows.slice(1)
    .reduce(function (acc, cols) {
      var title = cols[14];
      acc[title] = {
        title: cols[14],
        total: cols[12],
        ratings: {
          'Clear/compelling': cols[4],
          'Relevancy': cols[5],
          'Topic Coverage': cols[6],
          'Useful': cols[7],
          'Uniqueness': cols[8],
          'Expertise on subject': cols[9],
          'Speaker Experience': cols[10],
          'Personal Score': cols[11]
        }
      };

      return acc;
    }, {});

  callback(null, reviews);
};

//
// ### function readIssues (options, callback)
// Reads all the existing issues on the repo so we
// don't create duplicates
//
importer.readIssues = function (options, callback) {
  var github = options.github,
      repo   = options.repo.split('/');

  console.log('Reading issues | %s', options.repo);

  //
  // Remark: This is super brittle and only works
  // for 200 CFP submissions max.
  //
  async.parallel([
    async.apply(github.issues.repoIssues, {
      user: repo[0],
      repo: repo[1],
      per_page: 100,
      page: 1
    }),
    async.apply(github.issues.repoIssues, {
      user: repo[0],
      repo: repo[1],
      per_page: 100,
      page: 2
    })
  ], function (err, pages) {
    if (err) { return callback(err); }

    var all = pages[0].concat(pages[1])
    all.forEach(function (issue) {
      issue.source = {
        user: repo[0],
        repo: repo[1]
      }
    });

    callback(null, all);
  })
};

//
// ### function render (review)
// Returns a rendered comment for the review
//
importer.render = function (review) {
  var text = Object.keys(review.ratings)
    .map(function (name) {
      return util.format(' - %s: %d', name, review.ratings[name])
    });

  text.unshift('### Review: ');
  text.push('');
  text.push(util.format('### TOTAL SCORE: %d', review.total))

  return text.join('\n');
};
