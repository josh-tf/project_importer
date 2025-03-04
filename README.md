# project_importer

A command-line tool that copies items from a Notion database into a GitHub Project (v2) as draft issues.

For each page in the Notion database it takes the `Name` title, the `Summary` text and the page's paragraphs and headings, and creates a draft issue with those as its title and body. It then sets the project's Status and Priority single-select fields from the Notion `Status` and `Priority` properties. The mapping from Notion values (not started, in progress, review, done; high, medium, low) to GitHub option IDs is hard-coded in `src/index.ts`, so it has to be edited to match the target project's option IDs before a run.

It also has a few helper commands for finding the IDs it needs: `view_dbs` lists Notion databases, `list_content` lists pages and databases, `list_workspaces` lists workspace users, and `debug_fields` prints the properties of every item in the configured database. Run it with no argument to be prompted for a command.

## Stack

- TypeScript, run with ts-node or compiled with tsc
- `@notionhq/client` for the Notion API
- `@octokit/rest` (GraphQL) for GitHub Projects v2
- dotenv for configuration

## Develop

```sh
npm install
cp .env.example .env     # then fill in the values
npx ts-node src/index.ts view_dbs
npx ts-node src/index.ts run
```

Configuration is read from `.env`: `NOTION_API_KEY`, `NOTION_DATABASE_ID`, `GITHUB_TOKEN`, `GITHUB_ORG`, `GITHUB_PROJECT_NUMBER`, `GITHUB_FIELD_STATUS` and `GITHUB_FIELD_PRIORITY`. The project is looked up under an organisation, so `GITHUB_ORG` is required even though `.env.example` does not list it.

## License

[MIT](LICENSE)
