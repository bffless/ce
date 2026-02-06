import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';
import { Button } from './button';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description goes here</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Card content with some text inside.</p>
      </CardContent>
    </Card>
  ),
};

export const WithFooter: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Create Project</CardTitle>
        <CardDescription>Deploy your new project in one-click.</CardDescription>
      </CardHeader>
      <CardContent>
        <form>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium">Name</label>
              <input
                id="name"
                placeholder="Name of your project"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              />
            </div>
          </div>
        </form>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline">Cancel</Button>
        <Button>Deploy</Button>
      </CardFooter>
    </Card>
  ),
};

export const Notification: Story = {
  render: () => (
    <Card className="w-[380px]">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>You have 3 unread messages.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-start gap-4 rounded-md border p-4">
          <span className="flex h-2 w-2 translate-y-1 rounded-full bg-blue-500" />
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none">New deployment</p>
            <p className="text-sm text-muted-foreground">Your deployment was successful</p>
          </div>
        </div>
        <div className="flex items-start gap-4 rounded-md border p-4">
          <span className="flex h-2 w-2 translate-y-1 rounded-full bg-blue-500" />
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none">Storage alert</p>
            <p className="text-sm text-muted-foreground">You're approaching your storage limit</p>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button className="w-full">Mark all as read</Button>
      </CardFooter>
    </Card>
  ),
};

export const Stats: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total Deployments</CardDescription>
          <CardTitle className="text-4xl">1,234</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">+20% from last month</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Storage Used</CardDescription>
          <CardTitle className="text-4xl">45.2 GB</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">of 100 GB limit</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Active Projects</CardDescription>
          <CardTitle className="text-4xl">12</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">3 new this week</div>
        </CardContent>
      </Card>
    </div>
  ),
};
