import { AutomationMode } from '@prisma/client';
import {
  AUTOMATION_ACTIONS,
  AutomationError,
  validatePlan,
} from '@/modules/automation/automation.domain';
import { AutomationService } from '@/modules/automation/automation.service';
import {
  GitHubService,
  InvalidReviewTargetError,
} from './github.service';
import type { AutomationModeValue, ValidatedPlan } from '@/modules/automation/automation.domain';

export const GITHUB_DEVELOPMENT_TEMPLATES = [
  {
    id: 'repository_brief',
    title: 'Repository brief',
    description: 'Summarize recent commits, pull requests, the latest pull request checks, and completed reviews.',
  },
  {
    id: 'pull_request_investigation',
    title: 'Pull request investigation',
    description: 'Review available CI and saved findings, then draft an evidence-backed fix plan.',
  },
  {
    id: 'prepare_issue',
    title: 'Prepare and create an issue',
    description: 'Review the exact issue title and body before an approved issue is created.',
  },
  {
    id: 'prepare_pr_comment',
    title: 'Prepare and post a pull request comment',
    description: 'Review the exact comment before it is posted to an open pull request.',
  },
] as const;

export type GitHubDevelopmentTemplate = (typeof GITHUB_DEVELOPMENT_TEMPLATES)[number]['id'];

export interface GitHubDevelopmentWorkflowInput {
  template: GitHubDevelopmentTemplate;
  repository: string;
  pullRequestNumber?: number;
  issueTitle?: string;
  issueBody?: string;
  commentBody?: string;
  idempotencyKey?: string;
}

const automationService = new AutomationService();

export interface GitHubWorkflowCreator {
  create(
    userId: string,
    input: {
      goal: string;
      mode: AutomationModeValue;
      idempotencyKey?: string;
      plan?: ValidatedPlan;
    }
  ): Promise<unknown>;
}

export interface GitHubDevelopmentAccess {
  validateDevelopmentRepository(
    userId: string,
    repository: string,
    requireWriteAccess?: boolean
  ): Promise<{ fullName: string; htmlUrl: string; private: boolean }>;
  fetchPullRequestTarget(
    userId: string,
    repository: string,
    pullRequestNumber: number
  ): Promise<unknown>;
}

function buildPlan(input: GitHubDevelopmentWorkflowInput) {
  const needsPullRequest = [
    'pull_request_investigation',
    'prepare_pr_comment',
  ].includes(input.template);
  if (needsPullRequest && input.pullRequestNumber === undefined) {
    throw new AutomationError('A pull request number is required for this template.', 400);
  }

  const contextTask = {
    key: 'github-context',
    title: 'Read authorized GitHub context',
    description:
      'Fetch recent repository activity, available pull request checks, and completed CodeGuard reviews.',
    action: AUTOMATION_ACTIONS.COLLECT_GITHUB_CONTEXT,
    input: {
      repository: input.repository,
      ...(input.pullRequestNumber !== undefined
        ? { pullRequestNumber: input.pullRequestNumber }
        : {}),
    },
    dependsOn: [],
  };

  if (input.template === 'repository_brief' || input.template === 'pull_request_investigation') {
    const title =
      input.template === 'repository_brief'
        ? `Repository brief: ${input.repository}`
        : `Pull request #${input.pullRequestNumber} investigation`;
    const description =
      input.template === 'repository_brief'
        ? 'Summarize only returned GitHub activity and completed review records, citing their evidence links.'
        : 'Draft a proposed fix plan and, when source context is sufficient, an unapplied suggested patch with evidence links.';
    return validatePlan({
      title,
      tasks: [
        contextTask,
        {
          key: 'evidence-backed-draft',
          title: input.template === 'repository_brief' ? 'Draft repository brief' : 'Draft fix plan',
          description,
          action: AUTOMATION_ACTIONS.GENERATE_TEXT_DRAFT,
          input: {},
          dependsOn: ['github-context'],
        },
      ],
    });
  }

  if (input.template === 'prepare_issue') {
    if (!input.issueTitle || !input.issueBody) {
      throw new AutomationError('An issue title and body are required.', 400);
    }
    return validatePlan({
      title: `Create reviewed issue: ${input.issueTitle.slice(0, 80)}`,
      tasks: [
        contextTask,
        {
          key: 'create-github-issue',
          title: 'Create approved GitHub issue',
          description:
            'Create the exact issue title and body shown in this approval request after checking current repository write access.',
          action: AUTOMATION_ACTIONS.CREATE_GITHUB_ISSUE,
          input: {
            repository: input.repository,
            title: input.issueTitle,
            body: input.issueBody,
          },
          dependsOn: ['github-context'],
        },
      ],
    });
  }

  if (input.template === 'prepare_pr_comment') {
    if (!input.commentBody || input.pullRequestNumber === undefined) {
      throw new AutomationError('A pull request number and comment body are required.', 400);
    }
    return validatePlan({
      title: `Comment on ${input.repository} pull request #${input.pullRequestNumber}`,
      tasks: [
        contextTask,
        {
          key: 'create-github-pr-comment',
          title: 'Post approved pull request comment',
          description:
            'Post the exact comment shown in this approval request after rechecking the open pull request and repository write access.',
          action: AUTOMATION_ACTIONS.CREATE_GITHUB_PR_COMMENT,
          input: {
            repository: input.repository,
            pullRequestNumber: input.pullRequestNumber,
            body: input.commentBody,
          },
          dependsOn: ['github-context'],
        },
      ],
    });
  }

  throw new AutomationError('Unsupported GitHub development template.', 400);
}

export class GitHubDevelopmentService {
  constructor(
    private readonly github: GitHubDevelopmentAccess = new GitHubService(),
    private readonly workflows: GitHubWorkflowCreator = automationService
  ) {}

  async createWorkflow(
    userId: string,
    input: GitHubDevelopmentWorkflowInput
  ) {
    const requiresWrite = input.template === 'prepare_issue' || input.template === 'prepare_pr_comment';
    const repository = await this.github.validateDevelopmentRepository(
      userId,
      input.repository,
      requiresWrite
    );
    if (input.template === 'pull_request_investigation' || input.template === 'prepare_pr_comment') {
      if (input.pullRequestNumber === undefined) {
        throw new AutomationError('A pull request number is required for this template.', 400);
      }
      try {
        await this.github.fetchPullRequestTarget(
          userId,
          repository.fullName,
          input.pullRequestNumber
        );
      } catch (error) {
        if (error instanceof InvalidReviewTargetError) {
          throw new AutomationError(error.message, error.statusCode);
        }
        throw error;
      }
    }

    const normalizedInput = { ...input, repository: repository.fullName };
    const plan = buildPlan(normalizedInput);
    const goal = [
      input.template,
      repository.fullName,
      input.pullRequestNumber ?? '',
      input.issueTitle ?? '',
    ]
      .join(':')
      .slice(0, 2_000);
    return this.workflows.create(userId, {
      goal,
      plan,
      mode: AutomationMode.APPROVAL_REQUIRED,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
