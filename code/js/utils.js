const rp = require('request-promise');
const CryptoJS = require('crypto-js');

/**
 * UTILS
 */

const getAllTransactionsFromID = (host, address, txID) => {
    const port = 7890;
    const params = {
        'address': address,
    };
    if(txID) params.id = txID;
    const options = {
        uri: 'http://' + host + ':' + port + '/account/transfers/all',
        qs: params,
        json: true,
    };
    return rp(options).then((res) => {
        return res.data;
    });
};

const getBlockByHeight = (host, height) => {
    let port = 7890;
    let options = {
        method: 'POST',
        uri: 'http://' + host + ':' + port + '/block/at/public',
        body: {
            'height': height,
        },
        json: true,
    };
    return rp(options).then((res) => {
        return res;
    });
};

const getBatchAccountData = (host, addresses) => {
    let port = 7890;
    let d = [];
    for(var i = 0; i < addresses.length; i++){
        d.push({'account':addresses[i]});
    }
    let options = {
        method: 'POST',
        uri: 'http://' + host + ':' + port + '/account/get/batch',
        body: {
            'data': d,
        },
        json: true,
    };
    return rp(options).then((res) => {
        return res.data;
    });
};

const getBatchHistoricalAccountData = (host, addresses, block) => {
    let port = 7890;
    let d = [];
    for(var i = 0; i < addresses.length; i++){
        d.push({'account':addresses[i]});
    }
    let obj = {
        'accounts':d,
        'startHeight': block,
        'endHeight': block,
        'incrementBy': 1,
    };
    let options = {
        method: 'POST',
        uri: 'http://' + host + ':' + port + '/account/historical/get/batch',
        body: obj,
        json: true,
    };
    return rp(options).then((res) => {
        return res.data;
    });
};

const getCurrentHeight = (host) => {
    let port = 7890;
    const options = {
        uri: "http://" + host + ":" + port + "/chain/height",
        json: true,
    };
    return rp(options).then((res) => {
        return res.height;
    });
};

const hex2a = (hexx) => {
    const hex = hexx.toString();
    let str = '';
    for (let i = 0; i < hex.length; i += 2)
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
};

/**
 * fmtHexToUtf8() Convert hex to utf8
 * @param data: Hex data
 *
 * @return result: utf8 string
 */
let fmtHexToUtf8 = (data) => {
    const o = data;
    if (o && o.length > 2 && o[0] === 'f' && o[1] === 'e') {
        return "HEX: " + o.slice(2);
    }
    let result;
    try {
        result = decodeURIComponent(escape(hex2a(o)));
    } catch (e) {
        //result = "Error, message not properly encoded !";
        result = hex2a(o);
        console.log('invalid text input: ' + data);
    }
    return result;
};

let fmtHexMessage = (data) => {
    if (data === undefined) return data;
    if (data.type === 1) {
        return fmtHexToUtf8(data.payload);
    } else {
        return '';
    }
};

/**
 * getTransactionsWithString(address, str, start) Obtains every transaction message that contains a certain string (starting from position start)
 *
 * @param {string} address - NEM Address to explore
 * @param {string} str - String to find on addresses txs
 *
 * @return {promise} - A promise of the NetworkRequests service that returns an Array with the filtered messages
 */
const getTransactionsWithString = (host, address, str) => {

    const trans = [];

    // Recursive promise that will obtain every transaction from/to <address>, order it chronologically and return the ones
    // whose message contains <str>.
    const getTx = (txID) => {
        // Obtain all transactions to/from the address
        return getAllTransactionsFromID(host, address, txID).then((result) => {
            const transactions = result;

            // If not done
            if (transactions.length > 0) {
                // IDs are ordered, we grab the latest
                var last_id = transactions[transactions.length - 1].meta.id;

                // Order transactions chronologically
                transactions.sort((a, b) => {
                    return b.meta.height - a.meta.height;
                });

                // Iterate every transaction and add the valid ones to the array
                for (let i = 0; i < transactions.length; i++) {

                    let transaction = transactions[i].transaction;
                    const meta = transactions[i].meta;

                    // We don't care about the multisig metadata, just the inner Transaction (which has type 257)
                    if (transaction.type == 4100) {
                        transaction = transaction.otherTrans;
                    }
                    // Regular transactions
                    if (transaction.type == 257) {
                        // we are only using decoded messages
                        msg = fmtHexMessage(transaction.message);

                        // Check if transaction should be added depending on the message and its signer
                        if (msg.includes(str)) {
                            // We decode the message and store it
                            transaction.message = msg;
                            transactions[i].transaction = transaction;
                            trans.push(transactions[i]);
                        }
                    }
                }
                // Keep searching for more transactions after last_id
                return getTx(last_id);
            } else {
                return trans;
            }
        }).catch((e) => {
            console.log(e.message);
        });
    };

    return getTx();
};

/**
 * getFirstMessagesWithString(address,str,start) Obtains the last Message that contains string after position start
 *
 * @param {string} address - NEM Address to explore
 * @param {string} str - String to find on addresses txs
 *
 * @return {promise} - A promise of the NetworkRequests service that returns a string with the filtered message
 */
const getFirstMessageWithString = (host, address, str) => {

    // Get ALL Transactions since the API only allows us to iterate on a descending order
    return getTransactionsWithString(host, address, str).then((result) => {
        if (result && result.length > 0) {
            // Get the first message ever
            return result[result.length - 1].transaction.message;
        }
        return null;
    });
};

const NEM_EPOCH = Date.UTC(2015, 2, 29, 0, 6, 25, 0);

/**
 * Create a time stamp for a NEM transaction from a given timestamp
 *
 * @return {number} - The NEM transaction time stamp in milliseconds
 */
const toNEMTimeStamp = (date) => {
    return Math.floor((date / 1000) - (NEM_EPOCH / 1000));
};

/**
 * getHeightByTimestamp(timestamp) returns the last harvested block at the time of the timestamp.
 *
 * @param {integer} timestamp - javascript timestamp
 *
 * @return {promise} - a promise that returns the block height
 */
const getHeightByTimestamp = (host, timestamp) => {
    //1.Approximate (60s average block time)
    let nemTimestamp = toNEMTimeStamp(timestamp);
    let now = toNEMTimeStamp((new Date()).getTime());
    let elapsed = now - nemTimestamp;
    //get current height and approx from there
    return getCurrentHeight(host).then((curHeight) => {
        // nem blocks are approximately 1min
        let height = Math.floor(curHeight - (elapsed / 60));
        // console.log("block estimation->", height);
        // 2.Find exact block
        const findBlock = (height) => {
            return getBlockByHeight(host, height).then((block) => {
                let x = Math.floor((nemTimestamp - block.timeStamp) / 60);
                if (x < 0 && x > -10)
                    x = -1;
                if (x >= 0 && x <= 10)
                    x = 1;
                if (block.timeStamp <= nemTimestamp) {
                    return getBlockByHeight(host, height + 1).then((nextBlock) => {
                        //check if target
                        if (nextBlock.timeStamp > nemTimestamp) {
                            console.log("found  LB:", height);
                            return height;
                        } else {
                            // console.log("go up", height, "+", x);
                            return findBlock(height + x);
                        }
                    });
                } else {
                    // console.log("go down", height, x);
                    return findBlock(height + x);
                }
            });
        };

        return findBlock(height);
    });
};

const id2Prefix = (id) => {
    if (id === 104) {
        return "68";
    } else if (id === -104) {
        return "98";
    } else {
        return "60";
    }
};

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const b32encode = (s) => {
    let parts = [];
    let quanta = Math.floor((s.length / 5));
    let leftover = s.length % 5;

    if (leftover != 0) {
        for (let i = 0; i < (5 - leftover); i++) {
            s += '\x00';
        }
        quanta += 1;
    }

    for (let i = 0; i < quanta; i++) {
        parts.push(alphabet.charAt(s.charCodeAt(i * 5) >> 3));
        parts.push(alphabet.charAt(((s.charCodeAt(i * 5) & 0x07) << 2) | (s.charCodeAt(i * 5 + 1) >> 6)));
        parts.push(alphabet.charAt(((s.charCodeAt(i * 5 + 1) & 0x3F) >> 1)));
        parts.push(alphabet.charAt(((s.charCodeAt(i * 5 + 1) & 0x01) << 4) | (s.charCodeAt(i * 5 + 2) >> 4)));
        parts.push(alphabet.charAt(((s.charCodeAt(i * 5 + 2) & 0x0F) << 1) | (s.charCodeAt(i * 5 + 3) >> 7)));
        parts.push(alphabet.charAt(((s.charCodeAt(i * 5 + 3) & 0x7F) >> 2)));
        parts.push(alphabet.charAt(((s.charCodeAt(i * 5 + 3) & 0x03) << 3) | (s.charCodeAt(i * 5 + 4) >> 5)));
        parts.push(alphabet.charAt(((s.charCodeAt(i * 5 + 4) & 0x1F))));
    }

    let replace = 0;
    if (leftover == 1) replace = 6;
    else if (leftover == 2) replace = 4;
    else if (leftover == 3) replace = 3;
    else if (leftover == 4) replace = 1;

    for (let i = 0; i < replace; i++) parts.pop();
    for (let i = 0; i < replace; i++) parts.push("=");

    return parts.join("");
};

const toAddress = (publicKey, networkId) => {
    let binPubKey = CryptoJS.enc.Hex.parse(publicKey);
    let hash = CryptoJS.SHA3(binPubKey, {
        outputLength: 256
    });
    let hash2 = CryptoJS.RIPEMD160(hash);
    let networkPrefix = id2Prefix(networkId);
    let versionPrefixedRipemd160Hash = networkPrefix + CryptoJS.enc.Hex.stringify(hash2);
    let tempHash = CryptoJS.SHA3(CryptoJS.enc.Hex.parse(versionPrefixedRipemd160Hash), {
        outputLength: 256
    });
    let stepThreeChecksum = CryptoJS.enc.Hex.stringify(tempHash).substr(0, 8);
    let concatStepThreeAndStepSix = hex2a(versionPrefixedRipemd160Hash + stepThreeChecksum);
    return b32encode(concatStepThreeAndStepSix);
};

/**
 * getImportances(timestamp) returns an array of importances for an array of addresses
 *
 * @param {array} addresses - array with the addresses you want the importance for
 * @param {integer} block - the block in which to request importances. Optional
 *
 * @return {promise} - a promise that returns an array with all the importances
 */
const getImportances = (host, addresses, block) => {
    if (!block || (block < 0)) {
        return getBatchAccountData(host, addresses).then((data) => {
            return data.map((account)=>{
                return account.account.importance;
            });
        }).catch();
    } else {
        return getBatchHistoricalAccountData(host, addresses, block).then((data) => {
            return data.map((account)=>{
                return account.data[0].importance;
            });
        }).catch();
    }
};

module.exports = {
    getAllTransactionsFromID,
    getBlockByHeight,
    getBatchAccountData,
    getBatchHistoricalAccountData,
    getCurrentHeight,
    hex2a,
    fmtHexToUtf8,
    fmtHexMessage,
    getTransactionsWithString,
    getFirstMessageWithString,
    toNEMTimeStamp,
    getHeightByTimestamp,
    id2Prefix,
    b32encode,
    toAddress,
    getImportances,

};