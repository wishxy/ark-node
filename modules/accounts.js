'use strict';

var bignum = require('../helpers/bignum.js');
var BlockReward = require('../logic/blockReward.js');
var constants = require('../helpers/constants.js');
var crypto = require('crypto');
var arkjs = require('arkjs');
var extend = require('extend');
var Router = require('../helpers/router.js');
var schema = require('../schema/accounts.js');
var slots = require('../helpers/slots.js');
var transactionTypes = require('../helpers/transactionTypes.js');

// Private fields
var modules, library, self, __private = {}, shared = {};

__private.assetTypes = {};
__private.blockReward = new BlockReward();

// Constructor
function Accounts (cb, scope) {
	library = scope;
	self = this;

	__private.attachApi();

	var Vote = require('../logic/vote.js');
	__private.assetTypes[transactionTypes.VOTE] = library.logic.transaction.attachAssetType(
		transactionTypes.VOTE, new Vote()
	);

	setImmediate(cb, null, self);
}

// Private methods
__private.attachApi = function () {
	var router = new Router();

	router.use(function (req, res, next) {
		if (modules) { return next(); }
		res.status(500).send({success: false, error: 'Blockchain is loading'});
	});

	router.map(shared, {
		'get /getBalance': 'getBalance',
		'get /getPublicKey': 'getPublickey',
		'get /delegates': 'getDelegates',
		'get /delegates/fee': 'getDelegatesFee',
		'put /delegates': 'addDelegates',
		'get /': 'getAccount'
	});

	if (process.env.DEBUG && process.env.DEBUG.toUpperCase() === 'TRUE') {
		router.get('/getAllAccounts', function (req, res) {
			return res.json({success: true, accounts: __private.accounts});
		});
	}

	if (process.env.TOP && process.env.TOP.toUpperCase() === 'TRUE') {
		router.get('/top', function (req, res, next) {
			req.sanitize(req.query, schema.top, function (err, report, query) {
				if (err) { return next(err); }
				if (!report.isValid) { return res.json({success: false, error: report.issues}); }

				self.getAccounts({
					sort: {
						balance: -1
					},
					offset: query.offset,
					limit: (query.limit || 100)
				}, function (err, raw) {
					if (err) {
						return res.json({success: false, error: err});
					}

					var accounts = raw.map(function (account) {
						return {
							address: account.address,
							balance: account.balance,
							publicKey: account.publicKey
						};
					});

					res.json({success: true, accounts: accounts});
				});
			});
		});
	}

	router.get('/count', function (req, res) {
		return res.json({success: true, count: Object.keys(__private.accounts).length});
	});

	router.use(function (req, res, next) {
		res.status(500).send({success: false, error: 'API endpoint was not found'});
	});

	library.network.app.use('/api/accounts', router);
	library.network.app.use(function (err, req, res, next) {
		if (!err) { return next(); }
		library.logger.error('API error ' + req.url, err);
		res.status(500).send({success: false, error: 'API error: ' + err.message});
	});
};

// Public methods
Accounts.prototype.generateAddressByPublicKey = function (publicKey) {
	return arkjs.crypto.getAddress(publicKey);
};

Accounts.prototype.getAccount = function (filter, fields, cb) {
	if (filter.publicKey) {
		filter.address = self.generateAddressByPublicKey(filter.publicKey);
		delete filter.publicKey;
	}

	library.logic.account.get(filter, fields, cb);
};

Accounts.prototype.getAccounts = function (filter, fields, cb) {
	library.logic.account.getAll(filter, fields, cb);
};

Accounts.prototype.setAccountAndGet = function (data, cb) {
	var address = data.address || null;

	if (address === null) {
		if (data.publicKey) {
			address = self.generateAddressByPublicKey(data.publicKey);
		} else {
			return setImmediate(cb, 'Missing address or public key');
		}
	}

	if (!address) {
		return setImmediate(cb, 'Invalid public key');
	}

	library.logic.account.set(address, data, function (err) {
		if (err) {
			return setImmediate(cb, err);
		}
		return library.logic.account.get({address: address}, cb);
	});
};

Accounts.prototype.mergeAccountAndGet = function (data, cb) {
	var address = data.address || null;

	if (address === null) {
		if (data.publicKey) {
			address = self.generateAddressByPublicKey(data.publicKey);
		} else {
			return setImmediate(cb, 'Missing address or public key');
		}
	}

	if (!address) {
		return setImmediate(cb, 'Invalid public key');
	}

	return library.logic.account.merge(address, data, cb);
};

// Events
Accounts.prototype.onBind = function (scope) {
	modules = scope;

	__private.assetTypes[transactionTypes.VOTE].bind({
		modules: modules, library: library
	});
};

shared.getBalance = function (req, cb) {
	library.schema.validate(req.body, schema.getBalance, function (err) {
		if (err) {
			return setImmediate(cb, err[0].message);
		}

		var isAddress = /^[1-9A-Za-z]{1,52}[A]$/g;
		if (!isAddress.test(req.body.address)) {
			return setImmediate(cb, 'Invalid address');
		}

		self.getAccount({ address: req.body.address }, function (err, account) {
			if (err) {
				return setImmediate(cb, err);
			}

			var balance = account ? account.balance : '0';
			var unconfirmedBalance = account ? account.u_balance : '0';

			return setImmediate(cb, null, {balance: balance, unconfirmedBalance: unconfirmedBalance});
		});
	});
};

shared.getPublickey = function (req, cb) {
	library.schema.validate(req.body, schema.getPublicKey, function (err) {
		if (err) {
			return setImmediate(cb, err[0].message);
		}

		var isAddress = /^[1-9A-Za-z]{1,52}[A]$/g;
		if (!isAddress.test(req.body.address)) {
			return setImmediate(cb, 'Invalid address');
		}

		self.getAccount({ address: req.body.address }, function (err, account) {
			if (err) {
				return setImmediate(cb, err);
			}

			if (!account || !account.publicKey) {
				return setImmediate(cb, 'Account not found');
			}

			return setImmediate(cb, null, {publicKey: account.publicKey});
		});
	});
};

shared.getDelegates = function (req, cb) {
	library.schema.validate(req.body, schema.getDelegates, function (err) {
		if (err) {
			return setImmediate(cb, err[0].message);
		}

		self.getAccount({ address: req.body.address }, function (err, account) {
			if (err) {
				return setImmediate(cb, err);
			}

			if (!account) {
				return setImmediate(cb, 'Account not found');
			}

			if (account.delegates) {
				modules.delegates.getDelegates(req.body, function (err, res) {
					var delegates = res.delegates.filter(function (delegate) {
						return account.delegates.indexOf(delegate.publicKey) !== -1;
					});

					return setImmediate(cb, null, {delegates: delegates});
				});
			} else {
				return setImmediate(cb, null, {delegates: []});
			}
		});
	});
};

shared.getDelegatesFee = function (req, cb) {
	return setImmediate(cb, null, {fee: constants.fees.delegate});
};

shared.addDelegates = function (req, cb) {
	library.schema.validate(req.body, schema.addDelegates, function (err) {
		if (err) {
			return setImmediate(cb, err[0].message);
		}

		var hash = crypto.createHash('sha256').update(req.body.secret, 'utf8').digest();
		var keypair = library.ed.makeKeypair(hash);

		if (req.body.publicKey) {
			if (keypair.publicKey.toString('hex') !== req.body.publicKey) {
				return setImmediate(cb, 'Invalid passphrase');
			}
		}

		library.balancesSequence.add(function (cb) {
			if (req.body.multisigAccountPublicKey && req.body.multisigAccountPublicKey !== keypair.publicKey.toString('hex')) {
				modules.accounts.getAccount({ publicKey: req.body.multisigAccountPublicKey }, function (err, account) {
					if (err) {
						return setImmediate(cb, err);
					}

					if (!account || !account.publicKey) {
						return setImmediate(cb, 'Multisignature account not found');
					}

					if (!account.multisignatures || !account.multisignatures) {
						return setImmediate(cb, 'Account does not have multisignatures enabled');
					}

					if (account.multisignatures.indexOf(keypair.publicKey.toString('hex')) < 0) {
						return setImmediate(cb, 'Account does not belong to multisignature group');
					}

					modules.accounts.getAccount({ publicKey: keypair.publicKey }, function (err, requester) {
						if (err) {
							return setImmediate(cb, err);
						}

						if (!requester || !requester.publicKey) {
							return setImmediate(cb, 'Requester not found');
						}

						if (requester.secondSignature && !req.body.secondSecret) {
							return setImmediate(cb, 'Missing requester second passphrase');
						}

						if (requester.publicKey === account.publicKey) {
							return setImmediate(cb, 'Invalid requester public key');
						}

						var secondKeypair = null;

						if (requester.secondSignature) {
							var secondHash = crypto.createHash('sha256').update(req.body.secondSecret, 'utf8').digest();
							secondKeypair = library.ed.makeKeypair(secondHash);
						}

						var transaction;

						try {
							transaction = library.logic.transaction.create({
								type: transactionTypes.VOTE,
								votes: req.body.delegates,
								sender: account,
								keypair: keypair,
								secondKeypair: secondKeypair,
								requester: keypair
							});
						} catch (e) {
							return setImmediate(cb, e.toString());
						}

						modules.transactions.receiveTransactions([transaction], cb);
					});
				});
			} else {
				self.setAccountAndGet({ publicKey: keypair.publicKey.toString('hex') }, function (err, account) {
					if (err) {
						return setImmediate(cb, err);
					}

					if (!account || !account.publicKey) {
						return setImmediate(cb, 'Account not found');
					}

					if (account.secondSignature && !req.body.secondSecret) {
						return setImmediate(cb, 'Invalid second passphrase');
					}

					var secondKeypair = null;

					if (account.secondSignature) {
						var secondHash = crypto.createHash('sha256').update(req.body.secondSecret, 'utf8').digest();
						secondKeypair = library.ed.makeKeypair(secondHash);
					}

					var transaction;

					try {
						transaction = library.logic.transaction.create({
							type: transactionTypes.VOTE,
							votes: req.body.delegates,
							sender: account,
							keypair: keypair,
							secondKeypair: secondKeypair
						});
					} catch (e) {
						return setImmediate(cb, e.toString());
					}

					modules.transactions.receiveTransactions([transaction], cb);
				});
			}
		}, function (err, transaction) {
			if (err) {
				return setImmediate(cb, err);
			}

			return setImmediate(cb, null, {transaction: transaction[0]});
		});
	});
};

shared.getAccount = function (req, cb) {
	library.schema.validate(req.body, schema.getAccount, function (err) {
		if (err) {
			return setImmediate(cb, err[0].message);
		}

		var isAddress = /^[1-9A-Za-z]{1,52}[A]$/g;
		if (!isAddress.test(req.body.address)) {
			return setImmediate(cb, 'Invalid address');
		}

		self.getAccount({ address: req.body.address }, function (err, account) {
			if (err) {
				return setImmediate(cb, err);
			}

			if (!account) {
				return setImmediate(cb, 'Account not found');
			}

			return setImmediate(cb, null, {
				account: {
					address: account.address,
					unconfirmedBalance: account.u_balance,
					balance: account.balance,
					publicKey: account.publicKey,
					unconfirmedSignature: account.u_secondSignature,
					secondSignature: account.secondSignature,
					secondPublicKey: account.secondPublicKey,
					multisignatures: account.multisignatures || [],
					u_multisignatures: account.u_multisignatures || []
				}
			});
		});
	});
};

// Export
module.exports = Accounts;
