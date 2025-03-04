import { Client } from '@notionhq/client';
import { Octokit } from '@octokit/rest';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

// Init Notion and GitHub clients
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

interface BaseProperty {
  type: string;
}

interface TitleProperty extends BaseProperty {
  type: 'title';
  title: Array<{ plain_text: string }>;
}

// List all Notion databases
async function findDatabases(): Promise<void> {
  try {
    const response = await notion.search({
      filter: {
        property: 'object',
        value: 'database',
      },
    });

    const databases = response.results;
    if (databases.length === 0) {
      console.log('No databases found.');
      return;
    }

    console.log('Databases found:');
    databases.forEach((db) => {
      const title = (db as any).title?.map((t: any) => t.plain_text).join('') || 'Untitled';
      console.log(`ID: ${db.id} - Title: ${title}`);
    });
  } catch (error) {
    console.error('Error finding databases:', error);
  }
}

// List workspace users
async function listWorkspaceUsers(): Promise<void> {
  try {
    const response = await notion.users.list({});
    const users = response.results;

    if (users.length === 0) {
      console.log('No users found in this workspace.');
      return;
    }

    console.log('Users in this workspace:');
    users.forEach((user) => {
      console.log(`ID: ${user.id}, Name: ${(user as any).name}`);
    });
  } catch (error) {
    console.error('Error listing workspace users:', error);
  }
}

// List all pages and databases
async function listAllContent(): Promise<void> {
  try {
    const response = await notion.search({});
    const results = response.results;

    if (results.length === 0) {
      console.log('No content found.');
      return;
    }

    console.log('All content (pages + databases) found:');
    for (const item of results) {
      let title = 'Untitled';
      if (item.object === 'database') {
        title = (item as any).title?.map((t: any) => t.plain_text).join('') || 'Untitled Database';
      } else if (item.object === 'page') {
        const page = item as any;
        const pageProps = page.properties || {};
        const titleProp = Object.values(pageProps).find(
          (prop): prop is TitleProperty =>
            typeof prop === 'object' && prop !== null && 'type' in prop && prop.type === 'title'
        );
        if (titleProp?.title) {
          title = titleProp.title.map((t) => t.plain_text).join('') || 'Untitled Page';
        }
      }
      console.log(`ID: ${item.id} - Type: ${item.object} - Title: ${title}`);
    }
  } catch (error) {
    console.error('Error listing all content:', error);
  }
}

// Debug: list project fields
async function debugListProjectFields(): Promise<void> {
  try {
    const response = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID as string,
    });
    const projects = response.results;
    if (projects.length === 0) {
      console.log('No projects found.');
      return;
    }
    for (const project of projects) {
      const props = (project as any).properties;
      console.log(`Project ID: ${project.id}`);
      console.log('Property keys:', Object.keys(props));
      console.log('Full properties object:', props);
      console.log('----------------------------');
    }
  } catch (error) {
    console.error('Error listing project fields:', error);
  }
}

// Get text from a page
async function getPageText(pageId: string): Promise<string> {
  try {
    const blocksResponse: any = await notion.blocks.children.list({ block_id: pageId });
    const blocks = blocksResponse.results;
    const pageText = blocks
      .map((block: any) => {
        // Handle common text blocks
        switch (block.type) {
          case 'paragraph':
            return block.paragraph.rich_text.map((rt: any) => rt.plain_text).join('');
          case 'heading_1':
            return block.heading_1.rich_text.map((rt: any) => rt.plain_text).join('');
          case 'heading_2':
            return block.heading_2.rich_text.map((rt: any) => rt.plain_text).join('');
          case 'heading_3':
            return block.heading_3.rich_text.map((rt: any) => rt.plain_text).join('');
          default:
            return '';
        }
      })
      .filter((text: string) => text.trim() !== '')
      .join('\n\n');
    return pageText;
  } catch (err) {
    console.error(`Error fetching blocks for page ${pageId}:`, err);
    return '';
  }
}

// Import projects from Notion to GitHub Projects
async function importNotionProjectsToGitHub(): Promise<void> {
  try {
    // 1. Get projects from Notion
    const response = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID as string,
    });
    const projects = response.results;
    if (projects.length === 0) {
      console.log('No projects found.');
      return;
    }

    // 2. Get GitHub Project (v2) node ID via GraphQL
    const org = process.env.GITHUB_ORG as string;
    const projectNumber = Number(process.env.GITHUB_PROJECT_NUMBER);
    const getProjectResult: any = await octokit.graphql(
      `
      query($org: String!, $projectNumber: Int!) {
        organization(login: $org) {
          projectV2(number: $projectNumber) {
            id
          }
        }
      }
      `,
      { org, projectNumber }
    );
    const projectId = getProjectResult.organization.projectV2.id;
    const projectIdVar = String(projectId);

    // 3. Check GitHub field IDs
    const statusFieldIdVar = process.env.GITHUB_FIELD_STATUS;
    if (!statusFieldIdVar) {
      throw new Error('GITHUB_FIELD_STATUS is not defined in your environment.');
    }
    const priorityFieldIdVar = process.env.GITHUB_FIELD_PRIORITY;
    if (!priorityFieldIdVar) {
      throw new Error('GITHUB_FIELD_PRIORITY is not defined in your environment.');
    }

    // 4. Map Notion values to GitHub option IDs
    const statusOptionMapping: { [key: string]: string } = {
      'not started': 'f75ad846', // Todo
      'in progress': '47fc9ee4',
      review: '197bef76',
      done: '98236657',
    };
    const priorityOptionMapping: { [key: string]: string } = {
      high: 'be2146e2', // P0
      medium: 'dc717d23', // P1
      low: '694937d5', // P2
    };

    // 5. Loop through projects and import each
    for (const project of projects) {
      const props = (project as any).properties;
      const name: string =
        props.Name?.title?.map((item: any) => item.plain_text).join('') || 'Untitled';

      // Get summary if available
      const summary: string =
        props.Summary?.rich_text?.map((item: any) => item.plain_text).join('') || '';

      // Get full page text
      const pageText = await getPageText(project.id);

      // Combine summary and page text
      const description = summary + (pageText ? `\n\n---\n\n${pageText}` : '');

      // Get status from Notion
      const rawStatus = props.Status?.status?.name;
      console.log(`Raw status for project "${name}":`, rawStatus);
      const status = rawStatus ? rawStatus.toLowerCase() : 'not started';

      // Get priority from Notion
      const rawPriority = props.Priority?.select?.name;
      console.log(`Raw priority for project "${name}":`, rawPriority);
      const priority = rawPriority ? rawPriority.toLowerCase() : 'none';

      // Create draft item in GitHub project
      const createItemResult: any = await octokit.graphql(
        `
        mutation($projectId: ID!, $title: String!, $body: String!) {
          addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
            projectItem {
              id
            }
          }
        }
        `,
        {
          projectId: projectIdVar,
          title: name,
          body: description,
        }
      );
      const projectItemId = createItemResult.addProjectV2DraftIssue.projectItem.id;
      const projectItemIdVar = String(projectItemId);

      const statusOptionId = statusOptionMapping[status] || statusOptionMapping['not started'];
      const priorityOptionId = priorityOptionMapping[priority] || '';

      // Update the Status field
      await octokit.graphql(
        `
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
          updateProjectV2ItemFieldValue(
            input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }
          ) {
            projectV2Item { id }
          }
        }
        `,
        {
          projectId: projectIdVar,
          itemId: projectItemIdVar,
          fieldId: String(statusFieldIdVar),
          value: { singleSelectOptionId: statusOptionId },
        }
      );

      // Update the Priority field if applicable
      if (priorityOptionId) {
        await octokit.graphql(
          `
          mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
            updateProjectV2ItemFieldValue(
              input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }
            ) {
              projectV2Item { id }
            }
          }
          `,
          {
            projectId: projectIdVar,
            itemId: projectItemIdVar,
            fieldId: String(priorityFieldIdVar),
            value: { singleSelectOptionId: priorityOptionId },
          }
        );
      }

      console.log(`Imported project: "${name}" with Status "${status}" and Priority "${priority}"`);
    }
    console.log('All projects have been imported.');
  } catch (error) {
    console.error('Error importing projects to GitHub Project:', error);
  }
}

// Handle user commands
async function handleCommand(command: string) {
  switch (command) {
    case 'view_dbs':
      await findDatabases();
      break;
    case 'run':
      await importNotionProjectsToGitHub();
      break;
    case 'list_workspaces':
      await listWorkspaceUsers();
      break;
    case 'list_content':
      await listAllContent();
      break;
    case 'debug_fields':
      await debugListProjectFields();
      break;
    default:
      console.log('Invalid command. Use one of:');
      console.log('  view_dbs        - List Notion databases');
      console.log('  run             - Import projects to GitHub Projects (v2)');
      console.log('  list_workspaces - List workspace users');
      console.log('  list_content    - List all pages & databases');
      console.log('  debug_fields    - Debug: list project fields');
  }
}

// Main: prompt user if no command is given
async function main() {
  if (process.argv.length < 3) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      'Enter command (view_dbs | run | list_workspaces | list_content): ',
      async (answer) => {
        await handleCommand(answer.trim());
        rl.close();
      }
    );
  } else {
    const command = process.argv[2];
    await handleCommand(command);
  }
}

main();
