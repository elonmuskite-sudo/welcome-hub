import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

const prompt = read('../src/components/chat/UnsavedContactPrompt.jsx')
const sidebar = read('../src/components/chat/ChatSidebar.jsx')
const contacts = read('../src/components/chat/ContactsPanel.jsx')
const persistence = read('../src/lib/persistence.js')

test('looked-up numbers offer message, call and save actions only', () => {
  for (const source of [sidebar, contacts]) {
    assert.match(source, /requestLookupAction\('message'\)/)
    assert.match(source, /requestLookupAction\('call'\)/)
    assert.match(source, />\s*Save\s*</)
    // The delete option is removed from the interface.
    assert.doesNotMatch(source, /deleteContact|removeContact/)
  }
})

test('there is no backend function to delete a contact', () => {
  assert.doesNotMatch(persistence, /export (async )?function (deleteContact|removeContact)\b/)
})

test('the unsaved-contact warning offers Save First and Ignore', () => {
  assert.match(prompt, /Save First/)
  assert.match(prompt, />\s*Ignore\s*</)
  assert.match(prompt, /role="alertdialog"/)
})

test('both lookup surfaces guard call and chat behind the warning prompt', () => {
  for (const source of [sidebar, contacts]) {
    assert.match(source, /import UnsavedContactPrompt from '\.\/UnsavedContactPrompt'/)
    assert.match(source, /isContactSaved/)
    assert.match(source, /<UnsavedContactPrompt/)
  }
})

test('Save First saves the contact before running the chosen action', () => {
  for (const source of [sidebar, contacts]) {
    const handler = source.slice(source.indexOf('handlePromptSaveFirst'))
    assert.match(handler, /await addContact\(/)
    assert.match(handler, /await runLookupAction\(action/)
  }
})
