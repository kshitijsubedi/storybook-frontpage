import React from 'react';
import DocsLayout, { PureDocsLayout } from './DocsLayout';

const { toc: docsToc } = require('../../content/docs/toc');
const addStateToToc = require('../../util/add-state-to-toc');

const docsTocWithPaths = addStateToToc(docsToc);
const docsTocWithPathsAndFramework = addStateToToc(docsToc, '/docs/react');

const versions = {
  stable: [
    { version: 6.3, string: '6.3', label: 'latest' },
    { version: 6.2, string: '6.2' },
    { version: 6.1, string: '6.1' },
    { version: 6, string: '6.0' },
  ],
  preRelease: [
    { version: 6.4, string: '6.4', label: 'beta' },
    { version: 7, string: '7.0', label: 'alpha' },
  ],
};

export const pageContext = {
  framework: 'react',
  docsToc: docsTocWithPathsAndFramework,
  tocItem: { ...docsTocWithPaths[1].children[0], githubUrl: undefined },
  fullPath: '/docs/react/get-started/install',
  slug: '/docs/get-started/install',
  versions,
};

export default {
  title: 'Layout/DocsLayout',
  component: DocsLayout,
  excludeStories: ['pageContext'],
};

const Template = (args) => <DocsLayout {...args} />;

export const Base = Template.bind({});
Base.args = {
  children: 'children',
  pageContext,
};

export const NonLatestVersion = Template.bind({});
NonLatestVersion.args = {
  ...Base.args,
  isLatest: false,
};

export const Loading = (args) => <PureDocsLayout {...args} />;
Loading.args = {
  isLoading: true,
  framework: pageContext.framework,
  slug: pageContext.slug,
  versions,
};
