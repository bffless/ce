/**
 * Code templates for the Function Handler
 * These provide common starting points for data transformations
 */

export interface FunctionTemplate {
  id: string;
  name: string;
  category: 'transform' | 'array' | 'validation' | 'user';
  description: string;
  code: string;
}

export const functionTemplates: FunctionTemplate[] = [
  // Transform templates
  {
    id: 'add-field',
    name: 'Add Field',
    category: 'transform',
    description: 'Add a new field to the request body data',
    code: `function handler({ request }) {
  // Add a new field to the body
  return {
    ...request.body,
    timestamp: new Date().toISOString(),
  };
}`,
  },
  {
    id: 'rename-field',
    name: 'Rename Field',
    category: 'transform',
    description: 'Rename a field in the request body',
    code: `function handler({ request }) {
  // Rename a field (from 'oldName' to 'newName')
  const { oldName, ...rest } = request.body;
  return {
    ...rest,
    newName: oldName,
  };
}`,
  },
  {
    id: 'pick-fields',
    name: 'Pick Fields',
    category: 'transform',
    description: 'Select only specific fields from body',
    code: `function handler({ request }) {
  // Pick only specific fields
  const { field1, field2, field3 } = request.body;
  return { field1, field2, field3 };
}`,
  },
  {
    id: 'omit-fields',
    name: 'Omit Fields',
    category: 'transform',
    description: 'Remove specific fields from body',
    code: `function handler({ request }) {
  // Remove specific fields (password, secret)
  const { password, secret, ...rest } = request.body;
  return rest;
}`,
  },
  {
    id: 'format-date',
    name: 'Format Date',
    category: 'transform',
    description: 'Format a date field',
    code: `function handler({ request }) {
  // Format a date field
  const date = new Date(request.body.dateField);
  return {
    ...request.body,
    formattedDate: date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
  };
}`,
  },

  // Array templates
  {
    id: 'filter-array',
    name: 'Filter Array',
    category: 'array',
    description: 'Filter items in an array',
    code: `function handler({ request }) {
  // Filter items where active is true
  return request.body.items.filter(item => item.active);
}`,
  },
  {
    id: 'map-array',
    name: 'Map Array',
    category: 'array',
    description: 'Transform each item in an array',
    code: `function handler({ request }) {
  // Transform each item (extract id and name)
  return request.body.items.map(item => ({
    id: item.id,
    name: item.name,
  }));
}`,
  },
  {
    id: 'sort-array',
    name: 'Sort Array',
    category: 'array',
    description: 'Sort items in an array',
    code: `function handler({ request }) {
  // Sort items by a field (ascending)
  return [...request.body.items].sort((a, b) => {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
}`,
  },
  {
    id: 'group-by',
    name: 'Group By',
    category: 'array',
    description: 'Group items by a field value',
    code: `function handler({ request }) {
  // Group items by category
  return request.body.items.reduce((groups, item) => {
    const key = item.category;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
    return groups;
  }, {});
}`,
  },
  {
    id: 'find-item',
    name: 'Find Item',
    category: 'array',
    description: 'Find a single item in an array',
    code: `function handler({ request }) {
  // Find item by id
  return request.body.items.find(item => item.id === request.body.searchId);
}`,
  },

  // Validation templates
  {
    id: 'conditional-check',
    name: 'Conditional Check',
    category: 'validation',
    description: 'Check a condition and return different results',
    code: `function handler({ request }) {
  // Check condition and return different results
  if (request.body.amount > 1000) {
    return { status: 'requires_approval', amount: request.body.amount };
  }
  return { status: 'approved', amount: request.body.amount };
}`,
  },
  {
    id: 'validate-fields',
    name: 'Validate Fields',
    category: 'validation',
    description: 'Validate multiple fields',
    code: `function handler({ request }) {
  // Validate required fields
  const errors = [];

  if (!request.body.email) {
    errors.push('Email is required');
  }
  if (!request.body.name || request.body.name.length < 2) {
    errors.push('Name must be at least 2 characters');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, data: request.body };
}`,
  },

  // User context templates
  {
    id: 'add-owner',
    name: 'Add Owner Info',
    category: 'user',
    description: 'Add current user as owner',
    code: `function handler({ request, user }) {
  // Add owner information from current user
  return {
    ...request.body,
    ownerId: user?.id,
    ownerEmail: user?.email,
    createdAt: new Date().toISOString(),
  };
}`,
  },
  {
    id: 'check-role',
    name: 'Check User Role',
    category: 'user',
    description: 'Check user role before proceeding',
    code: `function handler({ request, user }) {
  // Check if user has required role
  if (user?.role !== 'admin') {
    return { error: 'Admin access required', allowed: false };
  }
  return { ...request.body, allowed: true };
}`,
  },
  {
    id: 'merge-user-data',
    name: 'Merge User Data',
    category: 'user',
    description: 'Combine body with user information',
    code: `function handler({ request, user }) {
  // Merge body with user metadata
  return {
    ...request.body,
    submittedBy: user?.email || 'anonymous',
    requestPath: request?.path,
    timestamp: new Date().toISOString(),
  };
}`,
  },
];

/**
 * Get templates grouped by category
 */
export function getTemplatesByCategory(): Record<string, FunctionTemplate[]> {
  return functionTemplates.reduce(
    (acc, template) => {
      if (!acc[template.category]) {
        acc[template.category] = [];
      }
      acc[template.category].push(template);
      return acc;
    },
    {} as Record<string, FunctionTemplate[]>,
  );
}

/**
 * Category display names
 */
export const categoryNames: Record<string, string> = {
  transform: 'Data Transform',
  array: 'Array Operations',
  validation: 'Validation',
  user: 'User Context',
};
