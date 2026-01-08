// biome-ignore-all lint/correctness/useUniqueElementIds: RAC Tab/TabPanel `id` props are internal state keys, not DOM ids.
/**
 * Test harness: Comprehensive component validation with theme integration.
 * Tests: Button, Toggle, Select, Tabs, Menu, FileUpload, FilePreview.
 * Validates: CSS variables, async states, tooltips, icons, all variants.
 */
import { Button } from '@parametric-portal/components-next/button';
import { FilePreview } from '@parametric-portal/components-next/file-preview';
import { FileUpload } from '@parametric-portal/components-next/file-upload';
import { Menu, MenuItem, MenuSection, MenuSeparator } from '@parametric-portal/components-next/menu';
import { Select, SelectItem, SelectSection, SelectSeparator } from '@parametric-portal/components-next/select';
import { Tab, TabList, TabPanel, Tabs } from '@parametric-portal/components-next/tabs';
import { Checkbox, CheckboxGroup, Switch } from '@parametric-portal/components-next/toggle';
import { useEffectMutate } from '@parametric-portal/runtime/hooks/effect';
import { useFileUpload } from '@parametric-portal/runtime/hooks/file-upload';
import { Runtime } from '@parametric-portal/runtime/runtime';
import { Duration, Effect, Layer } from 'effect';
import {
    Check,
    ChevronDown,
    Copy,
    Download,
    Edit,
    FileText,
    FolderOpen,
    Home,
    Info,
    Loader2,
    Mail,
    Minus,
    MoreVertical,
    Search,
    Settings,
    Trash2,
    Upload,
    User,
    XCircle,
} from 'lucide-react';
import type { FC, ReactNode } from 'react';

// --- [CONSTANTS] -------------------------------------------------------------

const testRuntime = Runtime.make(Layer.empty);
const simulateAsync = (ms: number, fail: boolean) =>
    Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(ms));
        return fail ? yield* Effect.fail(new Error('Failed')) : { ok: true };
    });

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const Section: FC<{ readonly children: ReactNode; readonly title: string }> = ({ children, title }) => (
    <section className='flex flex-col gap-4'>
        <h2 className='text-sm font-semibold uppercase tracking-wider text-(--color-text-500)'>{title}</h2>
        <div className='flex flex-wrap items-start gap-3'>{children}</div>
    </section>
);

// --- [ENTRY_POINT] -----------------------------------------------------------

const AsyncButtonDemo: FC = () => {
    const success = useEffectMutate(() => simulateAsync(1500, false));
    const failure = useEffectMutate(() => simulateAsync(1500, true));
    return (
        <>
            <Button
                asyncState={success.state}
                children={{ default: 'Success Flow', loading: 'Working...', success: 'Done!' }}
                color='primary'
                onPress={() => success.mutate(undefined)}
                prefix={{ loading: Loader2, success: Check }}
                size='md'
                variant='solid'
            />
            <Button
                asyncState={failure.state}
                children={{ default: 'Failure Flow', failure: 'Error!', loading: 'Trying...' }}
                color='danger'
                onPress={() => failure.mutate(undefined)}
                prefix={{ failure: XCircle, loading: Loader2 }}
                size='md'
                variant='solid'
            />
        </>
    );
};
const ToggleDemo: FC = () => {
    const toggle = useEffectMutate(() => simulateAsync(800, false));
    return (
        <>
            <Switch children={{ default: 'Small' }} color='primary' size='sm' />
            <Switch
                asyncState={toggle.state}
                children={{ default: 'With Async', loading: 'Saving...' }}
                color='primary'
                onChange={() => toggle.mutate(undefined)}
                size='md'
            />
            <Switch
                children={{ default: 'Large' }}
                color='primary'
                size='lg'
                tooltip={{ content: 'Large switch with tooltip' }}
            />
            <Checkbox color='success' icon={Check} size='md'>
                Accept Terms
            </Checkbox>
            <Checkbox color='primary' icon={Check} iconIndeterminate={Minus} isIndeterminate size='md'>
                Indeterminate
            </Checkbox>
            <CheckboxGroup color='secondary' orientation='horizontal' size='md'>
                <Checkbox icon={Check} size='md' value='a'>
                    Option A
                </Checkbox>
                <Checkbox icon={Check} size='md' value='b'>
                    Option B
                </Checkbox>
            </CheckboxGroup>
        </>
    );
};
const SelectDemo: FC = () => (
    <>
        {/* Basic Select with sections */}
        <Select color='primary' placeholder='Select page...' size='md' suffix={ChevronDown}>
            <SelectSection title='Navigation'>
                <SelectItem icon={{ default: Home }}>Home</SelectItem>
                <SelectItem icon={{ default: User }}>Profile</SelectItem>
                <SelectItem icon={{ default: Settings }} isDisabled>
                    Settings
                </SelectItem>
            </SelectSection>
            <SelectSeparator />
            <SelectSection title='Actions'>
                <SelectItem icon={{ default: Copy }}>Copy</SelectItem>
                <SelectItem icon={{ default: Download }}>Download</SelectItem>
            </SelectSection>
            <SelectSeparator />
            <SelectItem destructive icon={{ default: Trash2 }}>
                Delete Account
            </SelectItem>
        </Select>
        {/* Select with badges */}
        <Select color='secondary' placeholder='With badges' size='md' suffix={ChevronDown}>
            <SelectItem badge={5} description='5 unread messages' icon={{ default: Mail }}>
                Inbox
            </SelectItem>
            <SelectItem badge={12} icon={{ default: Edit }}>
                Drafts
            </SelectItem>
            <SelectItem badge={100} icon={{ default: FolderOpen }}>
                Archive
            </SelectItem>
        </Select>
        {/* Select with item tooltips */}
        <Select color='primary' placeholder='With tooltips' size='md' suffix={ChevronDown}>
            <SelectItem
                description='Navigate to home page'
                icon={{ default: Home }}
                tooltip={{ content: 'Go to dashboard' }}
            >
                Home
            </SelectItem>
            <SelectItem description='View your profile' icon={{ default: User }} tooltip={{ content: 'Edit settings' }}>
                Profile
            </SelectItem>
        </Select>
        {/* Sizes */}
        <Select color='secondary' placeholder='Small' size='sm' suffix={ChevronDown}>
            <SelectItem>First</SelectItem>
            <SelectItem>Second</SelectItem>
        </Select>
        <Select color='primary' isDisabled placeholder='Disabled' size='md' suffix={ChevronDown}>
            <SelectItem>Item</SelectItem>
        </Select>
    </>
);
const TabsDemo: FC = () => (
    <div className='flex flex-col gap-4 w-full max-w-md'>
        <Tabs color='primary' defaultSelectedKey='tab1' size='md'>
            <TabList>
                <Tab children={{ default: 'Home' }} icon={{ default: Home }} id='tab1' />
                <Tab children={{ default: 'Profile' }} icon={{ default: User }} id='tab2' />
                <Tab children={{ default: 'Settings' }} icon={{ default: Settings }} id='tab3' isDisabled />
            </TabList>
            <TabPanel id='tab1'>Home panel content with icon tab.</TabPanel>
            <TabPanel id='tab2'>Profile panel - navigate with arrows.</TabPanel>
            <TabPanel id='tab3'>Settings disabled.</TabPanel>
        </Tabs>
        <Tabs color='secondary' orientation='vertical' size='sm'>
            <TabList>
                <Tab children={{ default: 'Files' }} id='v1' />
                <Tab children={{ default: 'Edit' }} id='v2' />
            </TabList>
            <TabPanel id='v1'>Vertical tabs - Files</TabPanel>
            <TabPanel id='v2'>Vertical tabs - Edit</TabPanel>
        </Tabs>
    </div>
);
const MenuDemo: FC = () => (
    <Menu
        color='primary'
        size='md'
        trigger={
            <Button
                children={{ default: 'Actions' }}
                color='primary'
                prefix={{ default: MoreVertical }}
                size='md'
                variant='outline'
            />
        }
    >
        <MenuSection title='Edit'>
            <MenuItem children={{ default: 'Copy' }} icon={{ default: Copy }} shortcut='Cmd+C' />
            <MenuItem children={{ default: 'Edit' }} icon={{ default: Edit }} shortcut='Cmd+E' />
        </MenuSection>
        <MenuSeparator />
        <MenuSection title='Export'>
            <MenuItem children={{ default: 'Download' }} icon={{ default: Download }} />
            <MenuItem children={{ default: 'Export PDF' }} icon={{ default: FileText }} />
        </MenuSection>
        <MenuSeparator />
        <MenuItem children={{ default: 'Delete' }} destructive icon={{ default: Trash2 }} shortcut='Cmd+Del' />
    </Menu>
);
const FileDemo: FC = () => {
    const upload = useFileUpload({ allowedTypes: ['image/png', 'image/jpeg', 'image/svg+xml'] });
    return (
        <div className='flex flex-col gap-4'>
            <FileUpload
                {...upload.props}
                trigger={
                    <Button
                        children={{ default: 'Select Image' }}
                        color='primary'
                        prefix={{ default: Upload }}
                        size='sm'
                        variant='outline'
                    />
                }
            >
                {({ isDropTarget }) => (
                    <span className='text-sm text-(--color-text-600)'>
                        {isDropTarget ? 'Drop here!' : 'Drag, paste, or click'}
                    </span>
                )}
            </FileUpload>
            {upload.results[0] && <FilePreview file={upload.results[0]} />}
        </div>
    );
};
const DirectoryDemo: FC = () => {
    const upload = useFileUpload({ allowedTypes: ['image/png', 'image/jpeg'] });
    return (
        <FileUpload
            {...upload.props}
            acceptDirectory
            trigger={
                <Button
                    children={{ default: 'Folder' }}
                    color='secondary'
                    prefix={{ default: FolderOpen }}
                    size='sm'
                    variant='outline'
                />
            }
        >
            <span className='text-sm text-(--color-text-600)'>Found: {upload.results.length} files</span>
        </FileUpload>
    );
};
const AppContent: FC = () => (
    <main className='min-h-screen bg-(--color-surface-500) p-8'>
        <div className='mx-auto flex max-w-4xl flex-col gap-8'>
            <header className='flex flex-col gap-2'>
                <h1 className='text-2xl font-bold text-(--color-text-500)'>Component Test Harness</h1>
                <p className='text-sm text-(--color-text-700)'>
                    Validates: CSS variables, async states, tooltips, icons, all size/color/variant combinations.
                </p>
            </header>
            <Section title='Button Sizes + Variants'>
                <Button children={{ default: 'Small' }} color='primary' size='sm' variant='solid' />
                <Button children={{ default: 'Medium' }} color='primary' size='md' variant='solid' />
                <Button children={{ default: 'Large' }} color='primary' size='lg' variant='solid' />
                <Button children={{ default: 'Outline' }} color='primary' size='md' variant='outline' />
                <Button children={{ default: 'Ghost' }} color='primary' size='md' variant='ghost' />
            </Section>
            <Section title='Button Colors'>
                <Button children={{ default: 'Primary' }} color='primary' size='md' variant='solid' />
                <Button children={{ default: 'Secondary' }} color='secondary' size='md' variant='solid' />
                <Button children={{ default: 'Success' }} color='success' size='md' variant='solid' />
                <Button children={{ default: 'Warning' }} color='warning' size='md' variant='solid' />
                <Button children={{ default: 'Danger' }} color='danger' size='md' variant='solid' />
                <Button children={{ default: 'Accent' }} color='accent' size='md' variant='solid' />
            </Section>
            <Section title='Button Icons + States'>
                <Button
                    children={{ default: 'Search' }}
                    color='primary'
                    prefix={{ default: Search }}
                    size='md'
                    variant='solid'
                />
                <Button
                    children={{ default: 'Email' }}
                    color='secondary'
                    prefix={{ default: Mail }}
                    size='md'
                    variant='solid'
                />
                <Button children={{ default: 'Disabled' }} color='primary' isDisabled size='md' variant='solid' />
                <Button
                    children={{ default: <Info className='size-4' /> }}
                    color='primary'
                    size='md'
                    tooltip={{ content: 'With tooltip' }}
                    variant='solid'
                />
            </Section>
            <Section title='Async Button States'>
                <AsyncButtonDemo />
            </Section>
            <Section title='Toggle Components'>
                <ToggleDemo />
            </Section>
            <Section title='Select Components'>
                <SelectDemo />
            </Section>
            <Section title='Tabs Navigation'>
                <TabsDemo />
            </Section>
            <Section title='Menu with Sections'>
                <MenuDemo />
            </Section>
            <Section title='File Upload'>
                <FileDemo />
            </Section>
            <Section title='Directory Upload'>
                <DirectoryDemo />
            </Section>
        </div>
    </main>
);
const App: FC = () => (
    <Runtime.Provider disposeOnUnmount runtime={testRuntime}>
        <AppContent />
    </Runtime.Provider>
);

// --- [EXPORT] ----------------------------------------------------------------

export { App };
