#!/usr/bin/env node
// bin 入口：唯一允许顶层副作用的模块，不通过 package.json#exports 暴露。
import { runMain } from 'citty'
import { main, withErrorEnvelope } from './cli'

runMain(withErrorEnvelope(main))
