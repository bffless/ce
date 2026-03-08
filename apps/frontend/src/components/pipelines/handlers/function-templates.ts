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
    description: 'Add a new field to the input data',
    code: `function handler(data) {
  // Add a new field to the input
  return {
    ...data.input,
    timestamp: new Date().toISOString(),
  };
}`,
  },
  {
    id: 'rename-field',
    name: 'Rename Field',
    category: 'transform',
    description: 'Rename a field in the input data',
    code: `function handler(data) {
  // Rename a field (from 'oldName' to 'newName')
  const { oldName, ...rest } = data.input;
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
    description: 'Select only specific fields from input',
    code: `function handler(data) {
  // Pick only specific fields
  const { field1, field2, field3 } = data.input;
  return { field1, field2, field3 };
}`,
  },
  {
    id: 'omit-fields',
    name: 'Omit Fields',
    category: 'transform',
    description: 'Remove specific fields from input',
    code: `function handler(data) {
  // Remove specific fields (password, secret)
  const { password, secret, ...rest } = data.input;
  return rest;
}`,
  },
  {
    id: 'format-date',
    name: 'Format Date',
    category: 'transform',
    description: 'Format a date field',
    code: `function handler(data) {
  // Format a date field
  const date = new Date(data.input.dateField);
  return {
    ...data.input,
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
    code: `function handler(data) {
  // Filter items where active is true
  return data.input.items.filter(item => item.active);
}`,
  },
  {
    id: 'map-array',
    name: 'Map Array',
    category: 'array',
    description: 'Transform each item in an array',
    code: `function handler(data) {
  // Transform each item (extract id and name)
  return data.input.items.map(item => ({
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
    code: `function handler(data) {
  // Sort items by a field (ascending)
  return [...data.input.items].sort((a, b) => {
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
    code: `function handler(data) {
  // Group items by category
  return data.input.items.reduce((groups, item) => {
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
    code: `function handler(data) {
  // Find item by id
  return data.input.items.find(item => item.id === data.input.searchId);
}`,
  },

  // Validation templates
  {
    id: 'conditional-check',
    name: 'Conditional Check',
    category: 'validation',
    description: 'Check a condition and return different results',
    code: `function handler(data) {
  // Check condition and return different results
  if (data.input.amount > 1000) {
    return { status: 'requires_approval', amount: data.input.amount };
  }
  return { status: 'approved', amount: data.input.amount };
}`,
  },
  {
    id: 'validate-fields',
    name: 'Validate Fields',
    category: 'validation',
    description: 'Validate multiple fields',
    code: `function handler(data) {
  // Validate required fields
  const errors = [];

  if (!data.input.email) {
    errors.push('Email is required');
  }
  if (!data.input.name || data.input.name.length < 2) {
    errors.push('Name must be at least 2 characters');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, data: data.input };
}`,
  },

  // User context templates
  {
    id: 'add-owner',
    name: 'Add Owner Info',
    category: 'user',
    description: 'Add current user as owner',
    code: `function handler(data) {
  // Add owner information from current user
  return {
    ...data.input,
    ownerId: data.user?.id,
    ownerEmail: data.user?.email,
    createdAt: new Date().toISOString(),
  };
}`,
  },
  {
    id: 'check-role',
    name: 'Check User Role',
    category: 'user',
    description: 'Check user role before proceeding',
    code: `function handler(data) {
  // Check if user has required role
  if (data.user?.role !== 'admin') {
    return { error: 'Admin access required', allowed: false };
  }
  return { ...data.input, allowed: true };
}`,
  },
  {
    id: 'merge-user-data',
    name: 'Merge User Data',
    category: 'user',
    description: 'Combine input with user information',
    code: `function handler(data) {
  // Merge input with user metadata
  return {
    ...data.input,
    submittedBy: data.user?.email || 'anonymous',
    requestPath: data.request?.path,
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
