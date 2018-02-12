# NEM Voting technical specification

## Introduction
------

The NEM voting system allows anybody to create a poll on the NEM blockchain for other people to vote on. Poll creation and voting is implemented on NanoWallet, and results can be seen both in NanoWallet and some NEM block explorers.

The system leverages the already existing importance score from every account to weigh votes casted.

There is also the possibility of creating a poll with a whitelist where all votes casted weigh equally, and in the future if the NIS allows for it, a mosaic vote is going to be implemented where votes count proportional to the amount of a certain mosaic held by the voter.

In this document we describe the inner workings of the system.

## General structure
------

The voting structure consists of a series of NEM accounts and messages sent to them as a way of storing immutable information on the blockchain.

A poll is formed by (n + 1) accounts, where n is the number of options for the poll. These accounts are:
- The Poll Account (PA): The poll account is the main account for a poll. It contains all the info for a poll in various messages (described below)m such as the title, the description, the option addresses, etc.
- The Option Accounts(OA): Each poll has an option account for every possible option to vote on. Option accounts are empty and they contain no messages. The poll account contains all the addresses to the corresponding option accounts.

To vote on a poll a voter must send a transaction with 0 xem to the option account they wish to vote for, this must be done before the end of the poll, and the weight of their vote will be equal to the importance score from their account at the last harvested block before the poll ends.

With the two types of account described we can create a well formed poll and vote on it. If we input the poll address on the NanoWallet voting module manually we can count the votes and see all the information. But the poll will not appear in the initial menu in NanoWallet, nor in the Block explorers, since it is not on the public poll index. This is ok if you want to host a private poll, but as we will see there is a better way of doing it with private poll indexes.

Poll Indexes contain a list of Polls in the form of messages, that we will call poll headers. Poll headers contain basic info for a poll, like the title, the type of vote counting, and most importantly the poll accoiunt's address. This is sent to a poll index account at the time of the poll creation so that the poll is easily found and tracked. A public poll index account exists for general purpose public polls, but poll indexes can be created by users, both public and private (which creates a poll index where only the creator can submit polls).

The final poll structure would look something like this:

![poll structure](structure.png)

Where black arrows represent address pointers and colored arrows represent vote messages.

## Poll Generation
------

We are going to generate some accounts to create a poll. This accounts should not be owned by anybody, they are just used to store information, so when we crete a new account, we don't need to save the private key for it, it will just be discarded.

The information sent to the accounts is encoded as plain strings or JSON depending on the type of data. The messages are sent as unquoted strings.

Let's walk through the steps to create a poll:

### 0. Poll Index (optional)
First of all if you intend to publish your poll to a personal index, you should create it first.
Generate a new account and save the address.
The address is sent as a message to the poll index creator by himself, so that there will be a way to list all indexes created by an account. This mesage has the structure:

`createdPollIndex:TATWKUGFW5RABZZGHP3AXMISRHTTCZI643VFMA62`

where TAT...A62 is the poll index address.

Then we send a message to the poll index account to declare it as a poll index and to configure it as public or private. With structure:

`pollIndex:{"private":false}`

where the private field can be "true" or "false".

### 1. Generate Accounts
We need to generate one Poll Account and one account for every option, in no particular order, then save all the generated addresses. Address generation can take a little bit of time, this is why you have to wait when creating a poll.

### 2. Send Information to Accounts
Now all the accounts we need have been created, now we need to populate them with information, in the form of messages. We will first send the poll information to the Poll Account.

The messages in a NEM transaction have a length limit, which limits the details you can add to a single message, because of this we will split the information in different messages to optimize the quantity of information sent, while minimizing the fee cost of a poll creation.

Three messages are sent to the Poll Account for a regular poll:

1. formData:

This message contains the data that defines the poll parameters. An example message is:

`formData:{"title":"title","doe":1607772120000,"multiple":false,"type":0}`

where:
- title: The title of the poll.
- doe: Time of the poll ending when the votes will be definitive (in milliseconds since thursday, 1 January 1970)
- multiple: true or false. If set to true people is allowed to split their importance between different options.
- type: the counting type of polls:
    - 0 -> POI
    - 1 -> whitelist
    - 2 -> mosaic (not implemented)

2. description:

This message contains only the description of the poll, which we want to be as long as possible:

`description:this is the description`

3. options:

This message contains the poll's options and their respective option account addresses. It consists of an array of the option strings and a dictionary that maps the option strings to their respective option account.

The string array is redundant and could be removed to save space but it was left in there for compatibility with the old poll structure (explained below). You can add quite a lot of options before you surpass the message limit, so this is not a critical problem. The format is this:

`options:{"strings":["yes","no"],"link":{"yes":"TC2BOQO2JVBZMVSFTUILCSQBGOUAZIOCZXTHAP6S","no":"TCKMEQVM32F7BL6IHU2QF4S6JJVXIMDFXN6PXBN6"}}`

the strings parameter contains an array of the option strings. The link parameter is a map from strings to their respective option addresses.

4. whitelist (only for whitelist polls):

The whitelist message contains a whitelist with people who is allowed to vote. This is very limited by the message length and right now does not have very practical uses. The better option would be to distribute a mosaic for everyone you want to be allowed to vote and then create a mosaic poll. But as of the current NIS api there is no historical information on mosaics, so the mosaic vote counting can't be properly implemented in a decentralized way.

`whitelist:["TCCXQPJNPXAZFKV2IZHIFLAGTSN42WPNAQI6XGK3"]`

the message contains an array with the whitelisted addresses.




## Vote counting