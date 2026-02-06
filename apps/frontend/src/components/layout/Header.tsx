import { User, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { useGetSessionQuery, useSignOutMutation } from '@/services/authApi';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import logoSvg from '@/assets/logo.svg';

export function Header() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: sessionData, isLoading } = useGetSessionQuery();
  const [signOut] = useSignOutMutation();

  const isAuthenticated = Boolean(sessionData?.user);
  const user = sessionData?.user;

  const handleSignOut = async () => {
    try {
      await signOut().unwrap();
      toast({
        title: 'Signed out',
        description: 'You have been signed out successfully',
      });
      navigate('/');
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to sign out',
        variant: 'destructive',
      });
    }
  };

  const handleLogin = () => {
    navigate('/login');
  };

  const handleSettings = () => {
    navigate('/settings');
  };

  const handleAdminSettings = () => {
    navigate('/admin/settings');
  };

  const handleHome = () => {
    navigate('/');
  };

  return (
    <div className="border-b">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleHome}
            className="flex items-center gap-2"
          >
            <img src={logoSvg} alt="BFFLESS" className="h-5 w-5" />
            <span className="font-semibold">BFFLESS</span>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {!isLoading && (
            <>
              {isAuthenticated && user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-2">
                      <User className="h-4 w-4" />
                      <span className="text-sm">{user.email}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="px-2 py-1.5 text-sm">
                      <div className="font-medium">{user.email}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {user.role}
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleSettings}>
                      <SettingsIcon className="mr-2 h-4 w-4" />
                      Settings
                    </DropdownMenuItem>
                    {user.role === 'admin' && (
                      <DropdownMenuItem onClick={handleAdminSettings}>
                        <SettingsIcon className="mr-2 h-4 w-4" />
                        Site Settings
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleSignOut}>
                      <LogOut className="mr-2 h-4 w-4" />
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button variant="outline" size="sm" onClick={handleLogin}>
                  Login
                </Button>
              )}
            </>
          )}
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
