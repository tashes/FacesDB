import { scheduleResourceAccess } from './resourceLockScheduler.js'

export const resources = {
  collection: (collection) => `collection:${collection}`,
  document: (collection, document) => `document:${collection}:${document}`,
  index: (collection, index) => `index:${collection}:${index}`,
  indexCatalog: (collection) => `index-catalog:${collection}`,
  bucket: (collection, id) => `bucket:${collection}:${id}`,
}

export async function withResources(entries, operation, task, options) {
  return await scheduleResourceAccess(entries, options, task, { operation })
}

export function collectionResource(collection, mode = "shared") {
  return { resource: resources.collection(collection), mode }
}

export function documentResource(collection, document, mode = "shared") {
  return { resource: resources.document(collection, document), mode }
}

export function indexResource(collection, index, mode = "shared") {
  return { resource: resources.index(collection, index), mode }
}

export function indexCatalogResource(collection, mode = "shared") {
  return { resource: resources.indexCatalog(collection), mode }
}

export function bucketResource(collection, id, mode = "shared") {
  return { resource: resources.bucket(collection, id), mode }
}
