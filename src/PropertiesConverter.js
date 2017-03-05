/* @flow */
/* eslint-disable no-use-before-define, no-param-reassign */

import {
  TypeComposer,
  InputTypeComposer,
  GraphQLDate,
  GraphQLJSON,
  GraphQLBuffer,
  upperFirst,
  isObject,
} from 'graphql-compose';

import {
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLList,
  GraphQLObjectType,
  GraphQLInputObjectType,
} from 'graphql';

// import type { GraphQLObjectType } from 'graphql/type/definition';

export type ElasticMappingT = {
  properties: ElasticMappingPropertiesT,
};

export type ElasticMappingPropertiesT = {
  [propertyName: string]: ElasticPropertyT,
};

export type ElasticPropertyT = {
  type?: string,
  fields?: ElasticMappingPropertiesT,
  properties?: ElasticMappingPropertiesT,
};

export type InputFieldsMap = {
  [field: string]: GraphQLInputObjectType,
};

export type ConvertOptsT = {
  prefix?: ?string,
  postfix?: ?string,
};

export const typeMap = {
  text: GraphQLString,
  keyword: GraphQLString,
  string: GraphQLString,
  byte: GraphQLInt, // 8-bit integer
  short: GraphQLInt, // 16-bit integer
  integer: GraphQLInt, // 32-bit integer
  long: GraphQLInt, // 64-bit (should changed in future for 64 GraphQL type)
  double: GraphQLFloat, // 64-bit (should changed in future for 64 GraphQL type)
  float: GraphQLFloat, // 32-bit
  half_float: GraphQLFloat, // 16-bit
  scaled_float: GraphQLFloat,
  date: GraphQLDate,
  boolean: GraphQLBoolean,
  binary: GraphQLBuffer,
  token_count: GraphQLInt,
};

export function convertToSourceTC(
  mapping: ElasticMappingT | ElasticPropertyT,
  typeName: string,
  opts?: ConvertOptsT = {}
): TypeComposer {
  if (!mapping || !mapping.properties) {
    throw new Error(
      'You provide incorrect mapping. It should be an object `{ properties: {} }`'
    );
  }
  if (!typeName || typeof typeName !== 'string') {
    throw new Error(
      'You provide empty name for type. Second argument `typeName` should be non-empty string.'
    );
  }

  const tc = new TypeComposer(
    new GraphQLObjectType({
      name: `${opts.prefix || ''}${typeName}${opts.postfix || ''}`,
      description: 'Elasticsearch mapping does not contains info about ' +
        'is field plural or not. So `propName` is singular and returns value ' +
        'or first value from array. ' +
        '`propNameA` is plural and returns array of values.',
      fields: {},
    })
  );

  const { properties = {} } = mapping;
  const fields = {};

  Object.keys(properties).forEach(name => {
    const gqType = propertyToGraphQLType(
      properties[name],
      `${typeName}${upperFirst(name)}`,
      opts
    );
    if (gqType) {
      fields[name] = {
        type: gqType,
        resolve: source => {
          if (Array.isArray(source[name])) {
            return source[name][0];
          }
          return source[name];
        },
      };
      fields[`${name}A`] = {
        type: new GraphQLList(gqType),
        resolve: source => {
          if (Array.isArray(source[name])) {
            return source[name];
          }
          return [source[name]];
        },
      };
    }
  });

  tc.addFields(fields);

  return tc;
}

export function propertyToGraphQLType(
  prop: ElasticPropertyT,
  typeName?: string,
  opts?: ConvertOptsT
): GraphQLObjectType {
  if (!prop || (typeof prop.type !== 'string' && !prop.properties)) {
    throw new Error('You provide incorrect Elastic property config.');
  }

  if (prop.properties) {
    // object type with subfields
    return convertToSourceTC(prop, typeName || '', opts).getType();
  }

  if (prop.type && typeMap[prop.type]) {
    return typeMap[prop.type];
  }

  return GraphQLJSON;
}

export function inputPropertiesToGraphQLTypes(
  prop: ElasticPropertyT | ElasticMappingT,
  filterFn: (prop: any) => boolean,
  fieldName?: string = '',
  result?: InputFieldsMap = {}
): InputFieldsMap {
  if (!prop || (typeof prop.type !== 'string' && !prop.properties)) {
    throw new Error('You provide incorrect Elastic property config.');
  }

  // mapping
  if (prop.properties && isObject(prop.properties)) {
    Object.keys(prop.properties).forEach(subFieldName => {
      inputPropertiesToGraphQLTypes(
        // $FlowFixMe
        prop.properties[subFieldName],
        filterFn,
        [fieldName, subFieldName].filter(o => !!o).join('__'),
        result
      );
    });
    return result;
  }

  // object type with subfields
  if (prop.fields && isObject(prop.fields)) {
    // $FlowFixMe
    Object.keys(prop.fields).forEach(subFieldName => {
      inputPropertiesToGraphQLTypes(
        // $FlowFixMe
        prop.fields[subFieldName],
        filterFn,
        [fieldName, subFieldName].filter(o => !!o).join('__'),
        result
      );
    });
  }

  if ({}.hasOwnProperty.call(prop, 'index') && !prop.index) {
    return result;
  }

  if (filterFn(prop) && prop.type && fieldName) {
    // $FlowFixMe
    result[fieldName] = typeMap[prop.type] || GraphQLJSON;
  }

  return result;
}

export function convertToAggregatableITC(
  mapping: ElasticMappingT | ElasticPropertyT,
  typeName: string,
  opts?: ConvertOptsT = {}
): InputTypeComposer {
  if (!mapping || !mapping.properties) {
    throw new Error(
      'You provide incorrect mapping. It should be an object `{ properties: {} }`'
    );
  }
  if (!typeName || typeof typeName !== 'string') {
    throw new Error(
      'You provide empty name for type. Second argument `typeName` should be non-empty string.'
    );
  }

  const itc = new InputTypeComposer(
    new GraphQLInputObjectType({
      name: `${opts.prefix || ''}${typeName}${opts.postfix || ''}`,
      description: 'Input type which contains non-string properties which ' +
        'can be used in aggregation and filters.',
      fields: {},
    })
  );

  itc.addFields(
    inputPropertiesToGraphQLTypes(mapping, prop => {
      if (prop.type === 'text' || prop.type === 'string') {
        return false;
      }
      return true;
    })
  );

  return itc;
}

export function convertToSearchableITC(
  mapping: ElasticMappingT | ElasticPropertyT,
  typeName: string,
  opts?: ConvertOptsT = {}
): InputTypeComposer {
  if (!mapping || !mapping.properties) {
    throw new Error(
      'You provide incorrect mapping. It should be an object `{ properties: {} }`'
    );
  }
  if (!typeName || typeof typeName !== 'string') {
    throw new Error(
      'You provide empty name for type. Second argument `typeName` should be non-empty string.'
    );
  }

  const itc = new InputTypeComposer(
    new GraphQLInputObjectType({
      name: `${opts.prefix || ''}${typeName}${opts.postfix || ''}`,
      description: 'Input type which contains non-string properties which ' +
        'can be used in aggregation and filters.',
      fields: {},
    })
  );

  itc.addFields(
    inputPropertiesToGraphQLTypes(mapping, () => true)
  );

  return itc;
}

export function convertToAnalyzedITC(
  mapping: ElasticMappingT | ElasticPropertyT,
  typeName: string,
  opts?: ConvertOptsT = {}
): InputTypeComposer {
  if (!mapping || !mapping.properties) {
    throw new Error(
      'You provide incorrect mapping. It should be an object `{ properties: {} }`'
    );
  }
  if (!typeName || typeof typeName !== 'string') {
    throw new Error(
      'You provide empty name for type. Second argument `typeName` should be non-empty string.'
    );
  }

  const itc = new InputTypeComposer(
    new GraphQLInputObjectType({
      name: `${opts.prefix || ''}${typeName}${opts.postfix || ''}`,
      description: 'Input type which contains non-string properties which ' +
        'can be used in aggregation and filters.',
      fields: {},
    })
  );

  itc.addFields(
    inputPropertiesToGraphQLTypes(mapping, prop => {
      if (prop.type === 'text' || prop.type === 'string') {
        return true;
      }
      return false;
    })
  );

  return itc;
}
