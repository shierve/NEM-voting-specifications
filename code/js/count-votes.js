const utils = require('./utils');

/**
 * VOTING FUNCTIONS
 */

let HOST = '';
let NETWORK = '';

/**
 * pollDetails(pollAddress) returns the details of a poll stored in the given pollAddress
 *
 * @param {string} pollAddress - NEM address for the poll account
 *
 * @return {promise} - a promise that returns the details object of the poll
 */
const pollDetails = (pollAddress) => {
    var details = {
        formData: {},
        description: '',
        options: {},
        whitelist: null
    };

    const formDataPromise = utils.getFirstMessageWithString(HOST, pollAddress, "formData:");
    const descriptionPromise = utils.getFirstMessageWithString(HOST, pollAddress, "description:");
    const optionsPromise = utils.getFirstMessageWithString(HOST, pollAddress, "options:");

    return Promise.all([formDataPromise, descriptionPromise, optionsPromise])
    .then(([formDataResult, descriptionResult, optionsResult]) => {
        if(formDataResult === '' || descriptionResult === '' || optionsResult === ''){
            throw new Error("Address is not a well formed poll");
        }
        details.formData = (JSON.parse(formDataResult.replace('formData:', '')));
        details.description = (descriptionResult.replace('description:', ''));
        details.options = (JSON.parse(optionsResult.replace('options:', '')));

        const unique = (list) => {
            return list.sort().filter((item, pos, ary) => {
                return !pos || item !== ary[pos - 1];
            });
        };
        // this part is for compatibility with old poll structure.
        // Creates an array of addresses in the same order than their respective strings.
        var orderedAddresses = [];
        if(details.options.link){
            orderedAddresses = details.options.strings.map((option)=>{
                return details.options.link[option];
            });
        }
        else{
            orderedAddresses = details.options.addresses;
        }
        if(orderedAddresses.length !== unique(orderedAddresses).length){
            // same account for different options
            throw Error("Poll is invalid");
        }

        if (details.formData.type === 1) {
            return utils.getFirstMessageWithString(HOST, pollAddress, "whitelist:").then((whiteMsg) => {
                details.whitelist = (JSON.parse(whiteMsg.replace('whitelist:', '')));
                return details;
            }).catch((e)=>{
                throw e;
            });
        } else {
            return details;
        }
    }).catch((e)=>{
        throw e;
    });
};

/**
 * getWhitelistResults(pollAddress, end) returns the result object for the poll
 *
 * @param {string} pollAddress - NEM address of the poll
 * @param {integer} pollDetails - poll details object
 *
 * @return {promise} - A promise that returns the result object of the poll
 */
const getWhitelistResults = (pollAddress, pollDetails) => {
    let endBlock;
    let optionTransactions = [];
    let end = (pollDetails.formData.doe < Date.now()) ? (pollDetails.formData.doe) : (null);
    const details = pollDetails;

    let blockPromise;
    if (end) {
        blockPromise = utils.getHeightByTimestamp(HOST, end);
    } else {
        blockPromise = Promise.resolve(-1);
        console.log("\nThis poll has not finished yet, the results are orientative\n");
    }
    return blockPromise.then((block) => {
        endBlock = block;
        //get all Transactions
        var orderedAddresses = [];
        if(details.options.link){
            orderedAddresses = details.options.strings.map((option)=>{
                return details.options.link[option];
            });
        }
        else{
            orderedAddresses = details.options.addresses;
        }
        for (var i = 0; i < orderedAddresses.length; i++) {
            optionTransactions.push(utils.getTransactionsWithString(HOST, orderedAddresses[i], ""));
        }
        return Promise.all(optionTransactions);
    }).then((data) => {
        optionTransactions = data;
        if (end) {
            optionTransactions = optionTransactions.map((transactions) => {
                return transactions.filter((transaction) => {
                    return transaction.meta.height <= endBlock;
                });
            })
        } else {
            end = new Date().getTime();
        }
        var optionAddresses = [];
        //convert public keys to addresses and filter by WhiteList
        for (var i = 0; i < optionTransactions.length; i++) {
            optionAddresses.push(optionTransactions[i].map((transaction) => {
                return utils.toAddress(transaction.transaction.signer, NETWORK);
            }).filter((address) => {
                return (details.whitelist.indexOf(address) > -1);
            }));
        }
        //eliminate repetitions in array
        const unique = function(list) {
            return list.sort().filter((item, pos, ary) => {
                return !pos || item !== ary[pos - 1];
            });
        };
        optionAddresses = optionAddresses.map(unique); // the lists are now sorted

        // merge for two sorted arrays
        const merge = function(a, b) {
            var answer = new Array(a.length + b.length),
                i = 0,
                j = 0,
                k = 0;
            while (i < a.length && j < b.length) {
                if (a[i] < b[j]) {
                    answer[k] = a[i];
                    i++;
                } else {
                    answer[k] = b[j];
                    j++;
                }
                k++;
            }
            while (i < a.length) {
                answer[k] = a[i];
                i++;
                k++;
            }
            while (j < b.length) {
                answer[k] = b[j];
                j++;
                k++;
            }
            return answer;
        };
        // merge addresses from all options (they remain sorted)
        var allAddresses = optionAddresses.reduce(merge, []);
        //console.log("addresses", allAddresses);
        //we don't need to do anything if there are no votes
        if (allAddresses.length === 0) {
            var resultsObject = {
                "totalVotes": 0,
                "options": []
            }
            details.options.strings.map((option) => {
                resultsObject.options.push({"text": option, "votes": 0, "weighted": 0, "percentage": 0});
            });
            return resultsObject;
        }
        //if not multiple invalidate multiple votes
        let occurences = {};
        if (details.formData.multiple) {
            allAddresses.map((address)=>{
                if(!occurences[address]){
                    occurences[address] = 1;
                }
                else{
                    occurences[address]++;
                }
            });
        }
        else {
            var nullified = [];
            // Since we deleted repeated votes in the same option, we can know all repetitions now mean they voted in more than one option
            nullified = allAddresses.filter((item, pos, ary) => {
                return pos && item === ary[pos - 1];
            });
            //remove null votes
            optionAddresses = optionAddresses.map((addresses) => {
                return addresses.filter((address) => {
                    return (nullified.indexOf(address) < 0);
                });
            });
            allAddresses = allAddresses.filter((address) => {
                return (nullified.indexOf(address) < 0);
            });
            allAddresses.map((address)=>{
                occurences[address] = 1;
            });
        }
        // Only valid votes now on optionAddresses

        // calculate weights
        var weights = [];
        for(var i = 0; i < allAddresses.length; i++){
            weights[i] = 1/occurences[allAddresses[i]];
        }
        var addressWeights = {}; // maps addresses to their importance
        for (var i = 0; i < allAddresses.length; i++) {
            addressWeights[allAddresses[i]] = weights[i];
        }
        //count number of votes for each option
        var voteCounts = optionAddresses.map((addresses) => {
            return addresses.length;
        });
        //count votes weighted
        var voteCountsWeighted = optionAddresses.map((addresses) => {
            return addresses.reduce((accumulated, v) => {
                return accumulated + addressWeights[v];
            }, 0);
        });

        var totalVotes = allAddresses.length;
        var resultsObject = {
            "totalVotes": totalVotes,
            "options": []
        };
        for (var i = 0; i < details.options.strings.length; i++) {
            let percentage = (totalVotes === 0)
                ? (0)
                : (voteCountsWeighted[i] * 100 / totalVotes);
            resultsObject.options.push({"text": details.options.strings[i], "votes": voteCounts[i], "weighted": voteCountsWeighted[i], "percentage": percentage});
        }
        return resultsObject;
    }).catch();
};

/**
 * getPOIResults(pollAddress, end) returns the result object for the poll
 *
 * @param {string} pollAddress - NEM address of the poll
 * @param {integer} pollDetails - poll details object
 * and the importance score of the voters will be determined from historical data
 *
 * @return {promise} - A promise that returns the result object of the poll
 */
const getPOIResults = (pollAddress, pollDetails) => {
    let endBlock;
    let optionTransactions = [];
    let end = (pollDetails.formData.doe < Date.now()) ? (pollDetails.formData.doe) : (null);
    const details = pollDetails;

    let blockPromise;
    if (end) {
        blockPromise = utils.getHeightByTimestamp(HOST, end);
    } else {
        blockPromise = Promise.resolve(-1);
        console.log("\nThis poll has not finished yet, the results are orientative\n");
    }
    return blockPromise.then((block) => {
        endBlock = block;
        //get all Transactions
        var orderedAddresses = [];
        if(details.options.link){
            orderedAddresses = details.options.strings.map((option)=>{
                return details.options.link[option];
            });
        }
        else{
            orderedAddresses = details.options.addresses;
        }
        optionTransactions = orderedAddresses.map((address) => utils.getTransactionsWithString(HOST, address, ''));
        return Promise.all(optionTransactions);
    }).then((data) => {
        optionTransactions = data;
        //console.log("optionTransactions", optionTransactions);
        // Filter only the ones that voted before ending
        if (end) {
            optionTransactions = optionTransactions.map((transactions) => {
                return transactions.filter((transaction) => {
                    return transaction.meta.height <= endBlock;
                });
            })
        } else {
            end = -1;
        }
        // Only ransactions with 0 xem and 0 mosaics (Invalidates votes from exchanges and other cheating attempts)
        optionTransactions = optionTransactions.map((transactions) => {
            return transactions.filter((transaction) => {
                return (transaction.transaction.amount === 0) && (!transaction.transaction.mosaics);
            });
        });
        let optionAddresses = [];
        for (var i = 0; i < optionTransactions.length; i++) {
            //convert public keys to addresses
            optionAddresses.push(optionTransactions[i].map((transaction) => {
                return utils.toAddress(transaction.transaction.signer, NETWORK);
            }));
        }
        //eliminate repetitions in array
        const unique = function(list) {
            return list.sort().filter((item, pos, ary) => {
                return !pos || item !== ary[pos - 1];
            });
        };
        optionAddresses = optionAddresses.map(unique); // the lists are now sorted

        // merge for two sorted arrays
        const merge = function(a, b) {
            var answer = new Array(a.length + b.length),
                i = 0,
                j = 0,
                k = 0;
            while (i < a.length && j < b.length) {
                if (a[i] < b[j]) {
                    answer[k] = a[i];
                    i++;
                } else {
                    answer[k] = b[j];
                    j++;
                }
                k++;
            }
            while (i < a.length) {
                answer[k] = a[i];
                i++;
                k++;
            }
            while (j < b.length) {
                answer[k] = b[j];
                j++;
                k++;
            }
            return answer;
        };
        // merge addresses from all options (they remain sorted)
        var allAddresses = optionAddresses.reduce(merge, []);
        //we don't need to do anything if there are no votes
        if (allAddresses.length === 0) {
            var resultsObject = {
                "totalVotes": 0,
                "options": [],
            };
            details.options.strings.map((option) => {
                resultsObject.options.push({"text": option, "votes": 0, "weighted": 0, "percentage": 0});
            });
            return resultsObject;
        }

        //if not multiple invalidate multiple votes
        let occurences = {};
        if (details.formData.multiple) {
            allAddresses.map((address)=>{
                if(!occurences[address]){
                    occurences[address] = 1;
                }
                else{
                    occurences[address]++;
                }
            });
        }
        else {
            var nullified = [];
            // Since we deleted repeated votes in the same option, we can know all repetitions now mean they voted in more than one option
            nullified = allAddresses.filter((item, pos, ary) => {
                return pos && item === ary[pos - 1];
            });
            //remove null votes
            optionAddresses = optionAddresses.map((addresses) => {
                return addresses.filter((address) => {
                    return (nullified.indexOf(address) < 0);
                });
            });
            allAddresses = allAddresses.filter((address) => {
                return (nullified.indexOf(address) < 0);
            });
            allAddresses.map((address)=>{
                occurences[address] = 1;
            });
        }
        // Only valid votes now on optionAddresses
        // to only request once for every address even in multiple votes
        var uniqueAllAddresses = unique(allAddresses);

        // GET IMPORTANCES
        return utils.getImportances(HOST, uniqueAllAddresses, endBlock).then((importances) => {
            for(var i = 0; i < importances.length; i++){
                importances[i] /= occurences[uniqueAllAddresses[i]];
            }
            // calculate the sum of all importances
            var totalImportance = importances.reduce((a, b) => {
                return a + b;
            }, 0);
            var addressImportances = {}; // maps addresses to their importance
            for (var i = 0; i < allAddresses.length; i++) {
                addressImportances[uniqueAllAddresses[i]] = importances[i];
            }
            //count number of votes for each option
            var voteCounts = optionAddresses.map((addresses) => {
                return addresses.length;
            });
            //count votes weighted by importance
            var voteCountsWeighted = optionAddresses.map((addresses) => {
                return addresses.reduce((accumulated, v) => {
                    return accumulated + addressImportances[v];
                }, 0);
            });

            var totalVotes = allAddresses.length;
            var resultsObject = {
                "totalVotes": totalVotes,
                "options": []
            };
            for (var i = 0; i < details.options.strings.length; i++) {
                let percentage = (totalVotes === 0 || totalImportance === 0)
                    ? (0)
                    : (voteCountsWeighted[i] * 100 / totalImportance);
                resultsObject.options.push({"text": details.options.strings[i], "votes": voteCounts[i], "weighted": voteCountsWeighted[i], "percentage": percentage});
            }
            return resultsObject;
        }).catch((e) => {
            throw e;
        });
    }).catch((e) => {
        throw e;
    });
};

/**
 * getResults(pollAddress, type, end) returns the result object for the poll depending of the type of the counting
 *
 * @param {string} pollAddress - NEM address of the poll
 * @param {number} type - the type of the poll
 *                          0 for POI
 *                          1 for 1 account 1 vote
 *                          2 for mosaic
 * @param {integer} end - a timestamp for the end of the counting. All votes after this will be ignored,
 * and the weighted score of the voters will be determined from historical data
 *
 * @return {promise} - A promise that returns the result object of the poll
 */
const getResults = (pollAddress) => {
    NETWORK = (pollAddress[0] === 'T') ? -104 : 104;
    HOST = (NETWORK < 0) ? ('104.128.226.60') : ('88.99.192.82');
    // 1. get details
    return pollDetails(pollAddress).then((details) => {
        const type = details.formData.type;
        console.log("Poll Details:\n", details, '\n');
        // 2. choose type
        if (type === 0) {
            return getPOIResults(pollAddress, details);
        } else if (type === 1) {
            return getWhitelistResults(pollAddress, details);
        }
    }).catch((err) => {
        console.log("There was an error, make sure the address provided is a valid poll");
        return null;
    });
};

const pollAddress = process.argv[2];
console.log("Results for poll", pollAddress , ':\n');

getResults(pollAddress)
.then((res) => {
    console.log('results:\n', res);
}).catch((err) => {
    throw err;
});