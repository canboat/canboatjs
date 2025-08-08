/**
 * Copyright 2018 Scott Bender (scott@scottbender.net)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs'

const getDataPath = (options: any) => {
  if (options.app?.config?.configPath !== undefined) {
    return `${options.app.config.configPath}/canboatjs-data.json`
  }
}

export const getPersistedData = (options: any, id: string, key: string) => {
  const path = getDataPath(options)
  if (path !== undefined) {
    const content = fs.readFileSync(path)
    const data = JSON.parse(content.toString())
    return data[id] !== undefined ? data[id][key] : undefined
  }
}

export const savePersistedData = (
  options: any,
  id: string,
  key: string,
  value: any
) => {
  const path = getDataPath(options)
  if (path !== undefined) {
    let content: string

    try {
      content = fs.readFileSync(path).toString()
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        content = '{}'
      } else {
        throw err
      }
    }
    const data = JSON.parse(content.toString())
    if (data[id] === undefined) {
      data[id] = {}
    }
    data[id][key] = value
    fs.writeFileSync(path, JSON.stringify(data, null, 2))
  }
}
