import { tokenizeQuery, SearchToken } from "../tokenizer"

describe("Tokenizer", () => {
  test("tokenizes empty and whitespace-only queries to empty array", () => {
    expect(tokenizeQuery("")).toEqual([])
    expect(tokenizeQuery("   ")).toEqual([])
    expect(tokenizeQuery("\t  \n")).toEqual([])
  })

  test("tokenizes plain single and multi-term queries", () => {
    expect(tokenizeQuery("github")).toEqual<SearchToken[]>([{ value: "github" }])

    expect(tokenizeQuery("github user")).toEqual<SearchToken[]>([{ value: "github" }, { value: "user" }])

    expect(tokenizeQuery("  foo   bar   baz  ")).toEqual<SearchToken[]>([{ value: "foo" }, { value: "bar" }, { value: "baz" }])
  })

  test("tokenizes double-quoted plain phrases with spaces", () => {
    expect(tokenizeQuery('"multi word keyword"')).toEqual<SearchToken[]>([{ value: "multi word keyword" }])

    expect(tokenizeQuery('"John Doe" admin')).toEqual<SearchToken[]>([{ value: "John Doe" }, { value: "admin" }])
  })

  test("tokenizes prefixed fields without quotes", () => {
    expect(tokenizeQuery("u:user111")).toEqual<SearchToken[]>([{ field: "u", value: "user111" }])

    expect(tokenizeQuery("t:api")).toEqual<SearchToken[]>([{ field: "t", value: "api" }])

    expect(tokenizeQuery("url:https://github.com")).toEqual<SearchToken[]>([{ field: "url", value: "https://github.com" }])

    expect(tokenizeQuery("g:Servers")).toEqual<SearchToken[]>([{ field: "g", value: "Servers" }])
  })

  test("tokenizes prefixed fields with double quotes", () => {
    expect(tokenizeQuery('u:"John Doe"')).toEqual<SearchToken[]>([{ field: "u", value: "John Doe" }])

    expect(tokenizeQuery('g:"Recycle Bin"')).toEqual<SearchToken[]>([{ field: "g", value: "Recycle Bin" }])

    expect(tokenizeQuery('t:"ni d"')).toEqual<SearchToken[]>([{ field: "t", value: "ni d" }])

    expect(tokenizeQuery('url:"http://my internal site"')).toEqual<SearchToken[]>([{ field: "url", value: "http://my internal site" }])
  })

  test("tokenizes complex mixed queries", () => {
    const query = 'u:"John Doe" t:work "project alpha" url:github.com g:"Recycle Bin" keyword'
    expect(tokenizeQuery(query)).toEqual<SearchToken[]>([
      { field: "u", value: "John Doe" },
      { field: "t", value: "work" },
      { value: "project alpha" },
      { field: "url", value: "github.com" },
      { field: "g", value: "Recycle Bin" },
      { value: "keyword" }
    ])
  })

  test("is case-insensitive for prefixes", () => {
    expect(tokenizeQuery('U:"Admin User"')).toEqual<SearchToken[]>([{ field: "u", value: "Admin User" }])

    expect(tokenizeQuery('URL:example.com T:prod G:"My Safe"')).toEqual<SearchToken[]>([
      { field: "url", value: "example.com" },
      { field: "t", value: "prod" },
      { field: "g", value: "My Safe" }
    ])
  })

  test("handles unclosed double quotes gracefully", () => {
    expect(tokenizeQuery('u:"unclosed prefix')).toEqual<SearchToken[]>([{ field: "u", value: "unclosed prefix" }])

    expect(tokenizeQuery('"unclosed plain')).toEqual<SearchToken[]>([{ value: "unclosed plain" }])
  })

  test("treats unknown prefixes as plain terms", () => {
    expect(tokenizeQuery("foo:bar")).toEqual<SearchToken[]>([{ value: "foo:bar" }])
  })
})
