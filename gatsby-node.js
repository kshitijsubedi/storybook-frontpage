const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const { createFilePath } = require(`gatsby-source-filesystem`);

const { toc: docsToc } = require('./src/content/docs/toc');
const addStateToToc = require('./src/util/add-state-to-toc');
const buildPathWithFramework = require('./src/util/build-path-with-framework');
const getReleaseBranchUrl = require('./src/util/get-release-branch-url');
const { versionString, latestVersionString, isLatest } = require('./src/util/version-data');
const sourceDXData = require('./src/util/source-dx-data');
const { versions } = require('./src/util/versions');
const createIntegrationsPages = require('./src/util/create-integrations-pages');
const createHomePage = require('./src/util/create-home-page');
const siteMetadata = require('./site-metadata');

const {
  urls: { installDocsPageSlug },
} = siteMetadata;

const docsTocWithPaths = addStateToToc(docsToc);

const nextVersionString = versions.preRelease[0].string;

let frameworks;

exports.onCreateWebpackConfig = ({ actions }) => {
  actions.setWebpackConfig({
    resolve: {
      fallback: {
        path: require.resolve('path-browserify'),
      },
    },
  });
};

exports.sourceNodes = async ({ actions, createNodeId, createContentDigest }) => {
  await sourceDXData({ actions, createNodeId, createContentDigest });
};

exports.onCreateNode = ({ actions, getNode, node }) => {
  const { createNodeField } = actions;

  if (node.internal.type === 'Mdx') {
    const slug = createFilePath({
      node,
      getNode,
      basePath: 'content',
      trailingSlash: false,
    });

    const slugParts = slug.split('/').filter((p) => !!p);
    const [pageType] = slugParts;

    createNodeField({ node, name: 'pageType', value: pageType });
    createNodeField({ node, name: 'slug', value: slug });

    if (pageType === 'releases') {
      const [, releaseVersion] = slugParts;
      createNodeField({ node, name: 'iframeSlug', value: `/releases/iframe/${releaseVersion}/` });
      createNodeField({ node, name: 'version', value: releaseVersion });
    }
  }
};

exports.onCreatePage = ({ page, actions }) => {
  const { createPage, deletePage } = actions;

  // Show a special 404 page for the releases iframe path so that we can identify
  // when a version is passed that where we don't have any docs.
  if (page.path.match(/^\/releases\/iframe\/404\/$/)) {
    const oldPage = { ...page };
    // eslint-disable-next-line no-param-reassign
    page.matchPath = `/releases/iframe/*`;
    // Recreate the modified page
    deletePage(oldPage);
    createPage(page);
  }
};

exports.createPages = ({ actions, graphql }) => {
  const { createRedirect, createPage } = actions;
  return new Promise((resolve) => {
    graphql(`
      {
        docsPages: allMdx(filter: { fields: { pageType: { eq: "docs" } } }) {
          edges {
            node {
              fields {
                pageType
                slug
              }
            }
          }
        }
        releasePages: allMdx(filter: { fields: { pageType: { eq: "releases" } } }) {
          edges {
            node {
              fields {
                slug
                iframeSlug
                pageType
                version
              }
              frontmatter {
                prerelease
              }
            }
          }
        }
        site {
          siteMetadata {
            coreFrameworks
            communityFrameworks
          }
        }
      }
    `)
      .then(
        ({
          data: {
            docsPages: { edges: docsPagesEdges },
            releasePages: { edges: releasePagesEdges },
            site: {
              siteMetadata: { coreFrameworks, communityFrameworks },
            },
          },
        }) => {
          const sortedReleases = releasePagesEdges.sort(
            ({ node: aNode }, { node: bNode }) =>
              parseFloat(aNode.fields.version) - parseFloat(bNode.fields.version)
          );
          sortedReleases.forEach(({ node }) => {
            const { pageType, iframeSlug, slug, version: releaseVersion } = node.fields;
            // Data passed to context is available in page queries as GraphQL variables.
            const context = { pageType, slug, version: releaseVersion };

            createPage({
              path: slug,
              component: path.resolve(`./src/components/screens/ReleasesScreen/ReleasesScreen.js`),
              context,
            });

            createPage({
              path: iframeSlug,
              component: path.resolve(
                `./src/components/screens/ReleasesScreen/IframeReleasesScreen.js`
              ),
              context: {
                ...context,
                layout: 'iframe',
              },
            });
          });

          frameworks = [...coreFrameworks, ...communityFrameworks];
          const docsPagesSlugs = [];
          const docsPagesEdgesBySlug = Object.fromEntries(
            docsPagesEdges.map((edge) => [edge.node.fields.slug, edge])
          );
          const docsTocByFramework = Object.fromEntries(
            frameworks.map((framework) => [
              framework,
              addStateToToc(
                docsTocWithPaths,
                `/docs/${isLatest ? framework : `${versionString}/${framework}`}`
              ),
            ])
          );
          const createDocsPages = (tocItems) => {
            tocItems.forEach((tocItem, index) => {
              const { path: docsPagePath, children } = tocItem;

              if (docsPagePath) {
                const docEdge = docsPagesEdgesBySlug[docsPagePath];

                if (docEdge) {
                  const { pageType, slug } = docEdge.node.fields;
                  const nextTocItem = tocItems[index + 1];

                  frameworks.forEach((framework) => {
                    const fullPath = buildPathWithFramework(slug, framework);
                    createPage({
                      path: fullPath,
                      component: path.resolve(`./src/components/screens/DocsScreen/DocsScreen.tsx`),
                      context: {
                        pageType,
                        layout: 'docs',
                        slug,
                        fullPath,
                        versions,
                        framework,
                        docsToc: docsTocByFramework[framework],
                        tocItem,
                        ...(nextTocItem &&
                          nextTocItem.type === 'bullet-link' && {
                            nextTocItem,
                          }),
                        isInstallPage: slug === installDocsPageSlug,
                      },
                    });
                  });

                  docsPagesSlugs.push(slug);
                } else {
                  // eslint-disable-next-line no-console
                  console.log(`Not creating page for '${docsPagePath}'`);
                }
              }

              if (children) {
                createDocsPages(children);
              }
            });
          };

          createDocsPages(docsTocWithPaths);
        }
      )
      .then(() => createHomePage(actions, graphql, process.env.GATSBY_DOCS_ONLY))
      .then(() => {
        return process.env.GATSBY_SKIP_ADDON_PAGES || process.env.GATSBY_DOCS_ONLY || !isLatest
          ? Promise.resolve()
          : createIntegrationsPages({ actions, graphql });
      })
      .then(() => {
        resolve();
      });
  });
};

function getVersionData(distTag) {
  const versionFile = `./src/content/docs/versions/${distTag}.json`;
  if (!fs.existsSync(versionFile)) {
    return null;
  }
  const data = {
    [distTag]: JSON.parse(fs.readFileSync(versionFile)),
  };
  return data;
}

function generateVersionsFile() {
  const latest = getVersionData('latest');
  const next = getVersionData('next');
  const data = { ...latest, ...next };
  fs.writeFileSync('./public/versions-raw.json', JSON.stringify(data));
}

function updateRedirectsFile() {
  const originalContents = fs.readFileSync('./static/_redirects');

  const rawRedirects = fs.readFileSync(path.join(__dirname, './src/util/redirects-raw.txt'), {
    encoding: 'utf-8',
  });
  const redirectsWithFramework = rawRedirects
    .split(/\n/)
    .map((line) => line.split(/\s+/))
    .filter(([from, to, code]) => from && to && code)
    .reduce((acc, [from, to, code]) => {
      frameworks.forEach((f) =>
        // prettier-ignore
        acc.push(`${buildPathWithFramework(from, f)} ${buildPathWithFramework(to, f)} ${code}`)
      );
      return acc;
    }, [])
    .join('\n');

  const versionRedirects = [...versions.stable, ...versions.preRelease, { string: 'next' }]
    .reduce((acc, { string }) => {
      const isLatestLocal = string === latestVersionString;
      const versionStringLocal = string === 'next' ? nextVersionString : string;
      const versionSlug = isLatestLocal ? '' : `/${string}`;
      const versionBranch = isLatestLocal ? '' : getReleaseBranchUrl(versionStringLocal);
      const redirectCode = isLatestLocal ? 301 : 200;

      frameworks.forEach((f) =>
        // prettier-ignore
        acc.push(`/docs${versionSlug}/${f} ${versionBranch}${buildPathWithFramework(installDocsPageSlug, f, versionStringLocal)} ${redirectCode}`)
      );

      if (!isLatestLocal) {
        acc.push(
          // prettier-ignore
          `/docs${versionSlug} ${versionBranch}${buildPathWithFramework(installDocsPageSlug, frameworks[0], versionStringLocal)} 200`
        );
        acc.push(`/docs/${string}/* ${versionBranch}/docs/${versionStringLocal}/:splat 200`);
      } else {
        acc.push(`/docs/${versionStringLocal}/* /docs/:splat 301`);
      }

      return acc;
    }, [])
    .concat([`/releases /releases/${latestVersionString} 301`])
    .join('\n');

  // prettier-ignore
  fs.writeFileSync('./public/_redirects', `${originalContents}\n\n${redirectsWithFramework}\n\n${versionRedirects}`);
}

const otherSitemaps = [
  'blog/sitemap/sitemap-0.xml',
  'showcase/sitemap-0.xml',
  'tutorials/sitemap/sitemap-0.xml',
];

function getSitemapId(sitemap) {
  return sitemap.split('/')[0];
}

const sitemapFilename = 'sitemap.xml';

/* eslint-disable no-restricted-syntax, no-await-in-loop */
async function copyOtherSitemaps() {
  for (const sitemap of otherSitemaps) {
    const sitemapId = getSitemapId(sitemap);

    const directory = `./public/sitemap/${sitemapId}`;
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory);
    }

    try {
      const response = await fetch(`https://storybook.js.org/${sitemap}`);
      const content = await response.text();
      fs.writeFileSync(`./public/sitemap/${sitemapId}/${sitemapFilename}`, content);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }
}
/* eslint-enable no-restricted-syntax, no-await-in-loop */

async function updateSitemapIndex() {
  const data = await fs.promises.readFile('./public/sitemap/sitemap-index.xml');
  const originalContents = data.toString();

  const newLocations = otherSitemaps
    .map(
      (sitemap) =>
        // prettier-ignore
        `<sitemap><loc>https://storybook.js.org/sitemap/${getSitemapId(sitemap)}/${sitemapFilename}</loc></sitemap>`
    )
    .join('');

  const newContent = originalContents.replace(/(<sitemap>.*<\/sitemap>)/, `$1${newLocations}`);

  fs.writeFileSync('./public/sitemap/sitemap-index.xml', newContent);
}

exports.onPostBuild = async () => {
  if (isLatest) {
    await copyOtherSitemaps();
    await updateSitemapIndex();
    generateVersionsFile();
    updateRedirectsFile();
  }
};
