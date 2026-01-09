// biome-ignore-all lint/correctness/useUniqueElementIds: RAC Tab/TabPanel `id` props are internal state keys, not DOM ids.
/**
 * Test harness: Comprehensive component validation with theme integration.
 * Tests: Button, Toggle, Select, Tabs, Menu, FileUpload, FilePreview, Accordion.
 * Validates: CSS variables, async states, tooltips, icons, all variants.
 */
import { Button } from '@parametric-portal/components-next/actions/button';
import { Checkbox, CheckboxGroup, Switch } from '@parametric-portal/components-next/actions/toggle';
import { Select } from '@parametric-portal/components-next/inputs/select';
import { Menu } from '@parametric-portal/components-next/navigation/menu';
import { Tabs } from '@parametric-portal/components-next/navigation/tabs';
import { FilePreview } from '@parametric-portal/components-next/pickers/file-preview';
import { FileUpload } from '@parametric-portal/components-next/pickers/file-upload';
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
            <Select.Section title='Navigation'>
                <Select.Item icon={{ default: Home }}>Home</Select.Item>
                <Select.Item icon={{ default: User }}>Profile</Select.Item>
                <Select.Item icon={{ default: Settings }} isDisabled>
                    Settings
                </Select.Item>
            </Select.Section>
            <Select.Separator />
            <Select.Section title='Actions'>
                <Select.Item icon={{ default: Copy }}>Copy</Select.Item>
                <Select.Item icon={{ default: Download }}>Download</Select.Item>
            </Select.Section>
            <Select.Separator />
            <Select.Item destructive icon={{ default: Trash2 }}>
                Delete Account
            </Select.Item>
        </Select>
        {/* Select with badges */}
        <Select color='secondary' placeholder='With badges' size='md' suffix={ChevronDown}>
            <Select.Item badge={5} description='5 unread messages' icon={{ default: Mail }}>
                Inbox
            </Select.Item>
            <Select.Item badge={12} icon={{ default: Edit }}>
                Drafts
            </Select.Item>
            <Select.Item badge={100} icon={{ default: FolderOpen }}>
                Archive
            </Select.Item>
        </Select>
        {/* Select with item tooltips */}
        <Select color='primary' placeholder='With tooltips' size='md' suffix={ChevronDown}>
            <Select.Item
                description='Navigate to home page'
                icon={{ default: Home }}
                tooltip={{ content: 'Go to dashboard' }}
            >
                Home
            </Select.Item>
            <Select.Item
                description='View your profile'
                icon={{ default: User }}
                tooltip={{ content: 'Edit settings' }}
            >
                Profile
            </Select.Item>
        </Select>
        {/* Sizes */}
        <Select color='secondary' placeholder='Small' size='sm' suffix={ChevronDown}>
            <Select.Item>First</Select.Item>
            <Select.Item>Second</Select.Item>
        </Select>
        <Select color='primary' isDisabled placeholder='Disabled' size='md' suffix={ChevronDown}>
            <Select.Item>Item</Select.Item>
        </Select>
    </>
);
const TabsDemo: FC = () => (
    <div className='flex flex-col gap-4 w-full max-w-md'>
        <Tabs color='primary' defaultSelectedKey='tab1' size='md'>
            <Tabs.List>
                <Tabs.Tab children={{ default: 'Home' }} icon={{ default: Home }} id='tab1' />
                <Tabs.Tab children={{ default: 'Profile' }} icon={{ default: User }} id='tab2' />
                <Tabs.Tab children={{ default: 'Settings' }} icon={{ default: Settings }} id='tab3' isDisabled />
            </Tabs.List>
            <Tabs.Panel id='tab1'>Home panel content with icon tab.</Tabs.Panel>
            <Tabs.Panel id='tab2'>Profile panel - navigate with arrows.</Tabs.Panel>
            <Tabs.Panel id='tab3'>Settings disabled.</Tabs.Panel>
        </Tabs>
        <Tabs color='secondary' orientation='vertical' size='sm'>
            <Tabs.List>
                <Tabs.Tab children={{ default: 'Files' }} id='v1' />
                <Tabs.Tab children={{ default: 'Edit' }} id='v2' />
            </Tabs.List>
            <Tabs.Panel id='v1'>Vertical tabs - Files</Tabs.Panel>
            <Tabs.Panel id='v2'>Vertical tabs - Edit</Tabs.Panel>
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
        <Menu.Section title='Edit'>
            <Menu.Item children={{ default: 'Copy' }} copy />
            <Menu.Item children={{ default: 'Edit' }} icon={{ default: Edit }} shortcut='⌘E' />
        </Menu.Section>
        <Menu.Separator />
        <Menu.Section title='Export'>
            <Menu.Item children={{ default: 'Download' }} icon={{ default: Download }} />
            <Menu.Item children={{ default: 'Export PDF' }} icon={{ default: FileText }} />
        </Menu.Section>
        <Menu.Separator />
        <Menu.Item
            children={{ default: 'Delete' }}
            confirm={{
                buttons: [
                    { action: 'close', label: 'Cancel' },
                    { action: 'confirm', autoFocus: true, label: 'Delete' },
                ],
                description: 'This action cannot be undone.',
                title: 'Delete item?',
            }}
            delete
            destructive
        />
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
