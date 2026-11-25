const { Prisma } = require('@prisma/client');
const { ValidationError, BaseError } = require('../utils/errors');

const Decimal = Prisma.Decimal.clone({ precision: 40 });
const API_LIMIT = new Decimal(50_000_000);
const numericSources = new WeakMap();

function rememberAmountSource(key, value, context) {
  if (['amount', 'totalAmount', 'clientAmount', 'providerAmount'].includes(key) && typeof value === 'number' && context?.source) {
    let sources = numericSources.get(this);
    if (!sources) numericSources.set(this, sources = new Map());
    sources.set(key, context.source);
  }
  return value;
}

function amount(input, key = 'amount', scale = 8) {
  const value = input?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError('Enter a positive amount');
  const decimal = new Decimal(numericSources.get(input)?.get(key) ?? value);
  if (!decimal.isPositive() || decimal.isZero() || decimal.decimalPlaces() > scale || decimal.gt(API_LIMIT)) {
    throw new ValidationError(`Enter an amount from above zero through 50,000,000 with at most ${scale} fractional digits`);
  }
  return decimal;
}

function numericApi(value) {
  const numeric = value.toNumber();
  if (!new Decimal(numeric).eq(value)) throw new BaseError('Amount exceeds the precision of the numeric API');
  return numeric;
}

module.exports = { Decimal, API_LIMIT, amount, numericApi, rememberAmountSource };
