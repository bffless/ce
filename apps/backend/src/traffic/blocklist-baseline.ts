import { BlocklistPatternEntry } from './blocklist-compiler';

/**
 * The Baseline (issue #383/#391): the code-shipped set of universal
 * bot/scanner signatures applied to every domain by default, under the single
 * BOT_PROTECTION_ENABLED master toggle.
 *
 * Transcribed from the static nginx http-level map (docker/nginx/blocklist.conf,
 * retired by #392) into the structured { matchType, value } model, so the same
 * compiler that handles admin lists handles the Baseline. It is deliberately
 * NOT stored as data: it ships with the code so every upgrade improves it
 * without admins re-editing their lists, and it is not editable. A false
 * positive is rescued through a named Blocklist's allowlist, which always
 * wins over the Baseline.
 *
 * Case-insensitive matching (nginx `~*` parity) means one entry covers all
 * casings — e.g. /phpmyadmin also matches /phpMyAdmin.
 */

const prefix = (value: string): BlocklistPatternEntry => ({ matchType: 'prefix', value });
const exact = (value: string): BlocklistPatternEntry => ({ matchType: 'exact', value });
const extension = (value: string): BlocklistPatternEntry => ({ matchType: 'extension', value });

export const BASELINE_BLOCKLIST_ENTRIES: BlocklistPatternEntry[] = [
  // WordPress paths
  prefix('/wp-admin'),
  prefix('/wp-includes'),
  prefix('/wp-content'),
  prefix('/wp-login'),
  prefix('/wp-config'),
  prefix('/wordpress'),
  prefix('/wp/'),
  prefix('/blog/wp-'),
  prefix('/site/wp-'),
  prefix('/cms/wp-'),

  // Drupal paths
  prefix('/sites/default'),
  prefix('/sites/all'),
  prefix('/drupal'),
  prefix('/misc/drupal'),
  prefix('/modules/'),
  prefix('/includes/'),

  // Joomla paths
  prefix('/administrator'),
  prefix('/joomla'),
  prefix('/components/com_'),

  // Magento paths
  prefix('/magento'),
  prefix('/downloader'),
  prefix('/skin/adminhtml'),

  // phpMyAdmin and database tools
  prefix('/phpmyadmin'), // also covers /phpMyAdmin and /phpmyadmin2, /pma2, ... via prefix
  prefix('/pma'),
  prefix('/myadmin'),
  prefix('/mysql'),
  prefix('/mysqladmin'),
  prefix('/dbadmin'),
  prefix('/sqlmanager'),
  prefix('/mysqlmanager'),
  prefix('/php-my-admin'),

  // Admin/management paths (generic).
  // Note: /admin/settings is a legitimate React route, so only specific
  // scanner targets are blocked.
  prefix('/admin.php'),
  prefix('/admin/config'),
  prefix('/admin/login'),
  prefix('/admin/index.php'),
  prefix('/admin/admin'),
  prefix('/admin/includes'),
  prefix('/admin/images/slider'),
  prefix('/admin/fckeditor'),
  prefix('/admin/ckeditor'),
  prefix('/manager'),
  prefix('/cpanel'),
  prefix('/webadmin'),
  prefix('/siteadmin'),
  prefix('/adminpanel'),

  // File editors
  prefix('/fckeditor'),
  prefix('/ckeditor'),
  prefix('/kcfinder'),
  prefix('/editor'),
  prefix('/filemanager'),
  prefix('/elfinder'),
  prefix('/tinymce'),

  // CGI paths
  prefix('/cgi-bin'),
  prefix('/cgi/'),
  prefix('/wwwroot'),

  // Config and sensitive files (but NOT .well-known, which ACME needs)
  prefix('/.git'),
  prefix('/.svn'),
  prefix('/.hg'),
  prefix('/.env'),
  prefix('/.htaccess'),
  prefix('/.htpasswd'),
  prefix('/.DS_Store'),
  prefix('/.config'),
  prefix('/.aws'),
  prefix('/.ssh'),
  prefix('/.bash'),
  prefix('/.npm'),
  prefix('/.composer'),
  prefix('/config.php'),
  prefix('/config.inc'),
  prefix('/configuration.php'),
  prefix('/settings.php'),
  prefix('/web.config'),
  prefix('/database.yml'),
  prefix('/secrets.yml'),

  // Backup files
  prefix('/backup'),
  prefix('/backups'),
  prefix('/dump'),
  prefix('/dumps'),
  prefix('/.bak'),
  prefix('/.old'),
  prefix('/.orig'),
  prefix('/.save'),
  prefix('/.swp'),
  exact('/~'),
  extension('sql'),
  extension('sql.gz'),
  extension('sql.zip'),
  extension('tar.gz'),
  extension('tgz'),
  // Note: .zip, .rar, .7z stay allowed — they're legitimate assets.

  // Common exploit paths
  prefix('/shell'),
  prefix('/c99'),
  prefix('/r57'),
  prefix('/cmd'),
  prefix('/eval'),
  prefix('/exec'),
  prefix('/system'),
  prefix('/console'),
  prefix('/invoke'),
  prefix('/debug'),
  prefix('/test.php'),
  prefix('/info.php'),
  prefix('/phpinfo'),
  prefix('/server-status'),
  prefix('/server-info'),
  prefix('/status'),
  prefix('/jmx-console'),
  prefix('/web-console'),
  prefix('/axis2-admin'),
  prefix('/axis2/'),
  prefix('/solr'),
  prefix('/jenkins'),
  prefix('/hudson'),
  prefix('/actuator'),
  prefix('/api-docs'),
  prefix('/swagger'),
  prefix('/graphql'),
  prefix('/graphiql'),
  prefix('/playground'),

  // Version control web interfaces (/.git/* is covered by the /.git prefix)
  prefix('/.gitignore'),
  prefix('/.gitconfig'),

  // Log files
  prefix('/logs/'),
  prefix('/log/'),
  prefix('/error.log'),
  prefix('/access.log'),
  prefix('/debug.log'),
  extension('log'),

  // Other common scanner targets
  prefix('/xmlrpc.php'),
  prefix('/wlwmanifest.xml'),
  prefix('/license.txt'),
  prefix('/readme.html'),
  prefix('/readme.txt'),
  prefix('/changelog'),

  // Server-side script extensions this platform never serves
  extension('php'),
  ...Array.from({ length: 10 }, (_, i) => extension(`php${i}`)),
  extension('phtml'),
  extension('asp'),
  extension('aspx'),
  extension('ashx'),
  extension('asmx'),
  extension('jsp'),
  extension('jsf'),
  extension('jspx'),
  extension('cgi'),
  extension('pl'),
  extension('py'),
  extension('rb'),
  extension('lua'),
  extension('cfm'),
  extension('cfml'),

  // Shell scripts
  extension('sh'),
  extension('bash'),
  extension('zsh'),

  // Dangerous file types
  extension('exe'),
  extension('dll'),
  extension('bat'),
  extension('cmd'),
];
