/**
 * Test harness: Minimal component validation with theme integration.
 * Tests: Button (async states), TextField (multiline), Select (searchable), Toolbar, Slider, ColorPicker, DatePicker, Tree, TagGroup, Table, GridList, Breadcrumbs, Progress, Drawer.
 */
import { Button } from '@parametric-portal/components-next/actions/button';
import { Toolbar } from '@parametric-portal/components-next/actions/toolbar';
import { GridList } from '@parametric-portal/components-next/collections/grid-list';
import { Table } from '@parametric-portal/components-next/collections/table';
import { TagGroup } from '@parametric-portal/components-next/collections/tag-group';
import { Tree } from '@parametric-portal/components-next/collections/tree';
import { Progress } from '@parametric-portal/components-next/feedback/progress';
import { Select } from '@parametric-portal/components-next/inputs/select';
import { Slider } from '@parametric-portal/components-next/inputs/slider';
import { TextField } from '@parametric-portal/components-next/inputs/text-field';
import { Breadcrumbs } from '@parametric-portal/components-next/navigation/breadcrumbs';
import { Drawer } from '@parametric-portal/components-next/overlays/drawer';
import { ColorPicker } from '@parametric-portal/components-next/pickers/color-picker';
import { DatePicker } from '@parametric-portal/components-next/pickers/date-picker';
import { useEffectMutate } from '@parametric-portal/runtime/hooks/effect';
import { Runtime } from '@parametric-portal/runtime/runtime';
import { Duration, Effect, Layer } from 'effect';
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    Bold,
    Calendar,
    Check,
    ChevronDown,
    Edit,
    File,
    Folder,
    Home,
    Image,
    Italic,
    Loader2,
    Menu,
    PanelLeft,
    Settings,
    Star,
    Tag,
    Underline,
    XCircle,
} from 'lucide-react';
import { type FC, type ReactNode, useState } from 'react';
import type { Key, Selection, SortDescriptor } from 'react-aria-components';

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

// --- [DEMOS] -----------------------------------------------------------------

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

const TextFieldDemo: FC = () => {
    const asyncMutate = useEffectMutate(() => simulateAsync(1500, false));
    return (
        <>
            <TextField color='primary' label='Username' placeholder='Enter username...' size='md' />
            <TextField
                color='primary'
                description='Multiline textarea with 4 rows'
                label='Description'
                multiline
                placeholder='Enter description...'
                rows={4}
                size='md'
            />
            <TextField
                asyncState={asyncMutate.state}
                color='primary'
                label='Async Field'
                placeholder='Type and submit...'
                prefix={{ default: Edit, loading: Loader2, success: Check }}
                size='md'
            />
            <Button
                children={{ default: 'Submit' }}
                color='primary'
                onPress={() => asyncMutate.mutate(undefined)}
                size='sm'
                variant='outline'
            />
        </>
    );
};

const SelectDemo: FC = () => {
    const fruits = [
        { id: 'apple', label: 'Apple' },
        { id: 'banana', label: 'Banana' },
        { id: 'cherry', label: 'Cherry' },
        { id: 'date', label: 'Date' },
        { id: 'elderberry', label: 'Elderberry' },
        { id: 'fig', label: 'Fig' },
        { id: 'grape', label: 'Grape' },
        { id: 'honeydew', label: 'Honeydew' },
    ];
    return (
        <>
            <Select
                color='primary'
                items={fruits}
                label='Regular Select'
                placeholder='Select a fruit'
                size='md'
                suffix={ChevronDown}
            >
                {(item) => <Select.Item key={item.id}>{item.label}</Select.Item>}
            </Select>
            <Select
                color='primary'
                data-testid='searchable-select'
                items={fruits}
                label='Searchable Select'
                placeholder='Search fruits...'
                searchable
                size='md'
                suffix={ChevronDown}
            >
                {(item) => <Select.Item key={item.id}>{item.label}</Select.Item>}
            </Select>
        </>
    );
};

const ToolbarDemo: FC = () => (
    <>
        {/* Horizontal Toolbar */}
        <Toolbar
            aria-label='Text formatting'
            color='primary'
            data-testid='toolbar-horizontal'
            orientation='horizontal'
            size='md'
        >
            <Toolbar.Group aria-label='Text style'>
                <Toolbar.Item aria-label='Bold' prefix={Bold} tooltip={{ content: 'Bold (Ctrl+B)' }} />
                <Toolbar.Item aria-label='Italic' prefix={Italic} tooltip={{ content: 'Italic (Ctrl+I)' }} />
                <Toolbar.Item aria-label='Underline' prefix={Underline} tooltip={{ content: 'Underline (Ctrl+U)' }} />
            </Toolbar.Group>
            <Toolbar.Separator />
            <Toolbar.Group aria-label='Alignment'>
                <Toolbar.Item aria-label='Align left' defaultSelected prefix={AlignLeft} />
                <Toolbar.Item aria-label='Align center' prefix={AlignCenter} />
                <Toolbar.Item aria-label='Align right' prefix={AlignRight} />
            </Toolbar.Group>
        </Toolbar>

        {/* Vertical Toolbar */}
        <Toolbar
            aria-label='Vertical text formatting'
            color='primary'
            data-testid='toolbar-vertical'
            orientation='vertical'
            size='md'
        >
            <Toolbar.Group aria-label='Text style'>
                <Toolbar.Item aria-label='Bold' prefix={Bold} />
                <Toolbar.Item aria-label='Italic' prefix={Italic} />
            </Toolbar.Group>
            <Toolbar.Separator />
            <Toolbar.Group aria-label='Alignment'>
                <Toolbar.Item aria-label='Align left' prefix={AlignLeft} />
                <Toolbar.Item aria-label='Align center' prefix={AlignCenter} />
            </Toolbar.Group>
        </Toolbar>
    </>
);

const SliderDemo: FC = () => (
    <>
        {/* Single Value Slider */}
        <div className='flex flex-col gap-2 w-64'>
            <Slider
                aria-label='Volume'
                color='primary'
                data-testid='slider-single'
                defaultValue={50}
                label='Volume'
                showOutput
                size='md'
            >
                <Slider.Track>
                    <Slider.Thumb tooltip />
                </Slider.Track>
            </Slider>
        </div>

        {/* Range Slider */}
        <div className='flex flex-col gap-2 w-64'>
            <Slider
                aria-label='Price Range'
                color='primary'
                data-testid='slider-range'
                defaultValue={[25, 75]}
                label='Price Range'
                showOutput
                size='md'
            >
                <Slider.Track>
                    <Slider.Thumb index={0} tooltip />
                    <Slider.Thumb index={1} tooltip />
                </Slider.Track>
            </Slider>
        </div>

        {/* Disabled Slider */}
        <div className='flex flex-col gap-2 w-64'>
            <Slider
                aria-label='Disabled'
                color='primary'
                data-testid='slider-disabled'
                defaultValue={30}
                isDisabled
                label='Disabled'
                showOutput
                size='md'
            >
                <Slider.Track>
                    <Slider.Thumb />
                </Slider.Track>
            </Slider>
        </div>
    </>
);

const ColorPickerDemo: FC = () => (
    <>
        {/* Full ColorPicker with Area and Sliders - uses HSB color for saturation/brightness area */}
        <div className='flex flex-col gap-4'>
            <ColorPicker color='primary' data-testid='color-picker-full' defaultValue='hsb(217, 91%, 96%)' size='md'>
                <ColorPicker.Area xChannel='saturation' yChannel='brightness'>
                    <ColorPicker.Thumb tooltip />
                </ColorPicker.Area>
                <ColorPicker.Slider channel='hue'>
                    <ColorPicker.Thumb tooltip />
                </ColorPicker.Slider>
                <ColorPicker.Slider channel='alpha'>
                    <ColorPicker.Thumb tooltip />
                </ColorPicker.Slider>
                <ColorPicker.Field label='Hex Color' />
            </ColorPicker>
        </div>

        {/* ColorPicker with Wheel - uses HSB color for proper hue wheel */}
        <div className='flex flex-col gap-4'>
            <ColorPicker color='primary' data-testid='color-picker-wheel' defaultValue='hsb(161, 84%, 73%)' size='md'>
                <ColorPicker.Wheel innerRadius={40} outerRadius={80}>
                    <ColorPicker.WheelTrack />
                    <ColorPicker.Thumb tooltip />
                </ColorPicker.Wheel>
            </ColorPicker>
        </div>

        {/* SwatchPicker with Preset Colors */}
        <div className='flex flex-col gap-4'>
            <ColorPicker color='primary' data-testid='color-picker-swatches' defaultValue='#ef4444' size='md'>
                <ColorPicker.SwatchPicker>
                    <ColorPicker.SwatchPickerItem color='#ef4444' name='Red' />
                    <ColorPicker.SwatchPickerItem color='#f97316' name='Orange' />
                    <ColorPicker.SwatchPickerItem color='#eab308' name='Yellow' />
                    <ColorPicker.SwatchPickerItem color='#22c55e' name='Green' />
                    <ColorPicker.SwatchPickerItem color='#3b82f6' name='Blue' />
                    <ColorPicker.SwatchPickerItem color='#8b5cf6' name='Purple' />
                    <ColorPicker.SwatchPickerItem color='#ec4899' name='Pink' />
                    <ColorPicker.SwatchPickerItem color='#6b7280' name='Gray' />
                </ColorPicker.SwatchPicker>
            </ColorPicker>
        </div>
    </>
);

const DatePickerDemo: FC = () => (
    <>
        {/* Single Date Picker */}
        <div className='flex flex-col gap-2'>
            <label className='text-xs font-medium text-(--color-text-600)'>Single Date</label>
            <DatePicker color='primary' data-testid='date-picker-single' size='md'>
                <DatePicker.Group>
                    <DatePicker.Field />
                    <DatePicker.Trigger>
                        <Calendar className='size-4' />
                    </DatePicker.Trigger>
                </DatePicker.Group>
                <DatePicker.Popover>
                    <DatePicker.Calendar />
                </DatePicker.Popover>
            </DatePicker>
        </div>

        {/* Date Range Picker */}
        <div className='flex flex-col gap-2'>
            <label className='text-xs font-medium text-(--color-text-600)'>Date Range</label>
            <DatePicker.Range color='primary' data-testid='date-picker-range' size='md'>
                <DatePicker.Group>
                    <DatePicker.RangeField slot='start' />
                    <span className='px-1 text-(--color-text-600)'>–</span>
                    <DatePicker.RangeField slot='end' />
                    <DatePicker.Trigger>
                        <Calendar className='size-4' />
                    </DatePicker.Trigger>
                </DatePicker.Group>
                <DatePicker.Popover>
                    <DatePicker.RangeCalendar />
                </DatePicker.Popover>
            </DatePicker.Range>
        </div>

        {/* DateTime Picker with minute granularity */}
        <div className='flex flex-col gap-2'>
            <label className='text-xs font-medium text-(--color-text-600)'>Date & Time</label>
            <DatePicker color='primary' data-testid='date-picker-datetime' granularity='minute' size='md'>
                <DatePicker.Group>
                    <DatePicker.Field />
                    <DatePicker.Trigger>
                        <Calendar className='size-4' />
                    </DatePicker.Trigger>
                </DatePicker.Group>
                <DatePicker.Popover>
                    <DatePicker.Calendar />
                    <DatePicker.Time label='Time' />
                </DatePicker.Popover>
            </DatePicker>
        </div>
    </>
);

const TreeDemo: FC = () => (
    <>
        {/* Simplified API - title/prefix/tooltip */}
        <div className='flex flex-col gap-2 min-w-72'>
            <label className='text-xs font-medium text-(--color-text-600)'>File Explorer</label>
            <Tree
                aria-label='File explorer'
                color='primary'
                data-testid='tree-explorer'
                selectionMode='single'
                size='md'
            >
                <Tree.Item id='src' prefix={Folder} title='src' tooltip={{ content: 'Source files' }}>
                    <Tree.Group>
                        <Tree.Item id='src-components' prefix={Folder} title='components'>
                            <Tree.Group>
                                <Tree.Item
                                    id='src-button'
                                    prefix={File}
                                    title='button.tsx'
                                    tooltip={{ content: 'Button component' }}
                                />
                                <Tree.Item id='src-input' prefix={File} title='input.tsx' />
                            </Tree.Group>
                        </Tree.Item>
                        <Tree.Item id='src-index' prefix={File} title='index.tsx' />
                    </Tree.Group>
                </Tree.Item>
                <Tree.Item id='package' prefix={File} title='package.json' tooltip={{ content: 'Package manifest' }} />
            </Tree>
        </div>

        {/* Custom Content - Tree.ItemContent for complex labels */}
        <div className='flex flex-col gap-2 min-w-72'>
            <label className='text-xs font-medium text-(--color-text-600)'>Custom Content</label>
            <Tree aria-label='Custom tree' color='primary' data-testid='tree-custom' size='md'>
                <Tree.Item id='tagged'>
                    <Tree.ItemContent prefix={Tag} tooltip={{ content: 'Items with badge' }}>
                        <span className='flex items-center gap-1'>
                            Tagged <span className='text-xs opacity-50'>(3)</span>
                        </span>
                    </Tree.ItemContent>
                </Tree.Item>
            </Tree>
        </div>
    </>
);

const TagGroupDemo: FC = () => (
    <>
        {/* Removable Tags with Tooltips */}
        <div className='flex flex-col gap-2 min-w-72'>
            <TagGroup
                aria-label='Filter categories'
                color='primary'
                data-testid='tag-group-removable'
                onRemove={(_keys) => undefined}
                size='md'
            >
                <TagGroup.Label>Categories</TagGroup.Label>
                <TagGroup.List>
                    <TagGroup.Tag id='react' prefix={Tag} textValue='React' tooltip={{ content: 'JavaScript library' }}>
                        React
                    </TagGroup.Tag>
                    <TagGroup.Tag id='typescript' prefix={Tag} textValue='TypeScript'>
                        TypeScript
                    </TagGroup.Tag>
                    <TagGroup.Tag id='tailwind' prefix={Tag} textValue='Tailwind'>
                        Tailwind
                    </TagGroup.Tag>
                </TagGroup.List>
            </TagGroup>
        </div>

        {/* Selection + Variants */}
        <div className='flex flex-col gap-2 min-w-72'>
            <TagGroup
                aria-label='Select technologies'
                color='primary'
                data-testid='tag-group-selectable'
                defaultSelectedKeys={['frontend']}
                selectionMode='multiple'
                size='md'
                variant='solid'
            >
                <TagGroup.Label>Tech Stack</TagGroup.Label>
                <TagGroup.List>
                    <TagGroup.Tag id='frontend' textValue='Frontend'>
                        Frontend
                    </TagGroup.Tag>
                    <TagGroup.Tag id='backend' textValue='Backend'>
                        Backend
                    </TagGroup.Tag>
                    <TagGroup.Tag id='devops' textValue='DevOps'>
                        DevOps
                    </TagGroup.Tag>
                </TagGroup.List>
            </TagGroup>
        </div>

        {/* Link Tags */}
        <div className='flex flex-col gap-2 min-w-72'>
            <TagGroup aria-label='Documentation links' color='primary' data-testid='tag-group-links' size='md'>
                <TagGroup.Label>Resources</TagGroup.Label>
                <TagGroup.List>
                    <TagGroup.Tag
                        href='https://react.dev'
                        id='react-docs'
                        textValue='React Docs'
                        tooltip={{ content: 'Opens in new tab' }}
                    >
                        React Docs
                    </TagGroup.Tag>
                    <TagGroup.Tag href='https://typescriptlang.org' id='ts-docs' textValue='TypeScript'>
                        TypeScript
                    </TagGroup.Tag>
                    <TagGroup.Tag href='https://tailwindcss.com' id='tw-docs' textValue='Tailwind'>
                        Tailwind
                    </TagGroup.Tag>
                </TagGroup.List>
            </TagGroup>
        </div>
    </>
);

// Sample data for Table demos
const tableData = [
    { email: 'alice@example.com', id: 1, name: 'Alice Johnson', role: 'Engineer', status: 'Active' },
    { email: 'bob@example.com', id: 2, name: 'Bob Smith', role: 'Designer', status: 'Active' },
    { email: 'carol@example.com', id: 3, name: 'Carol Williams', role: 'Manager', status: 'Inactive' },
    { email: 'david@example.com', id: 4, name: 'David Brown', role: 'Engineer', status: 'Active' },
    { email: 'eva@example.com', id: 5, name: 'Eva Martinez', role: 'Designer', status: 'Active' },
];

const TableDemo: FC = () => {
    // State for sorting demo
    const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({ column: 'name', direction: 'ascending' });

    // State for selection demo
    const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set<Key>());

    // Sort the data based on sortDescriptor
    const sortedData = [...tableData].sort((a, b) => {
        const column = sortDescriptor.column as keyof typeof a;
        const aValue = a[column];
        const bValue = b[column];
        const cmp = String(aValue).localeCompare(String(bValue));
        return sortDescriptor.direction === 'descending' ? -cmp : cmp;
    });

    return (
        <>
            {/* Basic Table with Sorting */}
            <div className='flex flex-col gap-2 w-full'>
                <span className='text-xs font-medium text-(--color-text-600)'>Sortable Table</span>
                <Table
                    aria-label='Users table with sorting'
                    color='primary'
                    data-testid='table-sortable'
                    onSortChange={setSortDescriptor}
                    size='md'
                    sortDescriptor={sortDescriptor}
                >
                    <Table.Header>
                        <Table.Column allowsSorting id='name' isRowHeader>
                            Name
                        </Table.Column>
                        <Table.Column allowsSorting id='email'>
                            Email
                        </Table.Column>
                        <Table.Column allowsSorting id='role'>
                            Role
                        </Table.Column>
                        <Table.Column allowsSorting id='status'>
                            Status
                        </Table.Column>
                    </Table.Header>
                    <Table.Body emptyState={<span>No users found</span>}>
                        {sortedData.map((user) => (
                            <Table.Row id={user.id} key={user.id}>
                                <Table.Cell>{user.name}</Table.Cell>
                                <Table.Cell>{user.email}</Table.Cell>
                                <Table.Cell>{user.role}</Table.Cell>
                                <Table.Cell>{user.status}</Table.Cell>
                            </Table.Row>
                        ))}
                    </Table.Body>
                </Table>
            </div>

            {/* Table with Selection */}
            <div className='flex flex-col gap-2 w-full'>
                <span className='text-xs font-medium text-(--color-text-600)'>
                    Selectable Table (Selected:{' '}
                    {selectedKeys === 'all' ? 'All' : [...selectedKeys].join(', ') || 'None'})
                </span>
                <Table
                    aria-label='Users table with selection'
                    color='primary'
                    data-testid='table-selectable'
                    onSelectionChange={setSelectedKeys}
                    selectedKeys={selectedKeys}
                    selectionMode='multiple'
                    size='md'
                >
                    <Table.Header>
                        <Table.Column id='select' isRowHeader={false}>
                            {null}
                        </Table.Column>
                        <Table.Column id='name' isRowHeader>
                            Name
                        </Table.Column>
                        <Table.Column id='email'>Email</Table.Column>
                        <Table.Column id='role'>Role</Table.Column>
                    </Table.Header>
                    <Table.Body>
                        {tableData.map((user) => (
                            <Table.Row id={user.id} key={user.id}>
                                <Table.Cell>
                                    <Table.RowCheckbox />
                                </Table.Cell>
                                <Table.Cell>{user.name}</Table.Cell>
                                <Table.Cell>{user.email}</Table.Cell>
                                <Table.Cell>{user.role}</Table.Cell>
                            </Table.Row>
                        ))}
                    </Table.Body>
                </Table>
            </div>

            {/* Resizable Table */}
            <div className='flex flex-col gap-2 w-full'>
                <span className='text-xs font-medium text-(--color-text-600)'>Resizable Columns</span>
                <Table.ResizableContainer onResize={(_widths) => undefined}>
                    <Table
                        aria-label='Users table with resizable columns'
                        color='primary'
                        data-testid='table-resizable'
                        size='md'
                    >
                        <Table.Header>
                            <Table.Column defaultWidth='1fr' id='name' isRowHeader minWidth={100}>
                                Name
                                <Table.ColumnResizer />
                            </Table.Column>
                            <Table.Column defaultWidth='1fr' id='email' minWidth={150}>
                                Email
                                <Table.ColumnResizer />
                            </Table.Column>
                            <Table.Column defaultWidth={100} id='role' minWidth={80}>
                                Role
                                <Table.ColumnResizer />
                            </Table.Column>
                            <Table.Column defaultWidth={100} id='status' minWidth={80}>
                                Status
                            </Table.Column>
                        </Table.Header>
                        <Table.Body>
                            {tableData.map((user) => (
                                <Table.Row id={user.id} key={user.id}>
                                    <Table.Cell>{user.name}</Table.Cell>
                                    <Table.Cell tooltip={{ content: user.email }}>{user.email}</Table.Cell>
                                    <Table.Cell>{user.role}</Table.Cell>
                                    <Table.Cell>{user.status}</Table.Cell>
                                </Table.Row>
                            ))}
                        </Table.Body>
                    </Table>
                </Table.ResizableContainer>
            </div>
        </>
    );
};

const GridListDemo: FC = () => {
    const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set<Key>());
    return (
        <>
            {/* Single Selection GridList */}
            <div className='flex flex-col gap-2 min-w-72'>
                <span className='text-xs font-medium text-(--color-text-600)'>Single Selection</span>
                <GridList
                    aria-label='Image gallery'
                    color='primary'
                    data-testid='grid-list-single'
                    selectionMode='single'
                    size='md'
                >
                    <GridList.Item id='img-1' prefix={Image} tooltip={{ content: 'Beach sunset photo' }}>
                        Beach Sunset
                    </GridList.Item>
                    <GridList.Item id='img-2' prefix={Image} tooltip={{ content: 'Mountain landscape' }}>
                        Mountains
                    </GridList.Item>
                    <GridList.Item id='img-3' prefix={Image}>
                        City Skyline
                    </GridList.Item>
                    <GridList.Item id='img-4' prefix={Image}>
                        Forest Trail
                    </GridList.Item>
                </GridList>
            </div>

            {/* Multiple Selection GridList */}
            <div className='flex flex-col gap-2 min-w-72'>
                <span className='text-xs font-medium text-(--color-text-600)'>
                    Multiple Selection (Selected:{' '}
                    {selectedKeys === 'all' ? 'All' : [...selectedKeys].join(', ') || 'None'})
                </span>
                <GridList
                    aria-label='Favorites'
                    color='primary'
                    data-testid='grid-list-multiple'
                    onSelectionChange={setSelectedKeys}
                    selectedKeys={selectedKeys}
                    selectionMode='multiple'
                    size='md'
                >
                    <GridList.Item id='fav-1' prefix={Star}>
                        Favorite 1
                    </GridList.Item>
                    <GridList.Item id='fav-2' prefix={Star}>
                        Favorite 2
                    </GridList.Item>
                    <GridList.Item id='fav-3' prefix={Star}>
                        Favorite 3
                    </GridList.Item>
                    <GridList.Item id='fav-4' prefix={Star} isDisabled tooltip={{ content: 'This item is disabled' }}>
                        Disabled Item
                    </GridList.Item>
                </GridList>
            </div>

            {/* Non-selectable GridList with prefix/suffix */}
            <div className='flex flex-col gap-2 min-w-72'>
                <span className='text-xs font-medium text-(--color-text-600)'>Display Only (No Selection)</span>
                <GridList
                    aria-label='File icons'
                    color='primary'
                    data-testid='grid-list-display'
                    selectionMode='none'
                    size='md'
                >
                    <GridList.Item id='file-1' prefix={File} suffix={Check}>
                        Document.pdf
                    </GridList.Item>
                    <GridList.Item id='file-2' prefix={Folder}>
                        Projects
                    </GridList.Item>
                    <GridList.Item id='file-3' prefix={File}>
                        Notes.txt
                    </GridList.Item>
                </GridList>
            </div>
        </>
    );
};

const BreadcrumbsDemo: FC = () => (
    <>
        <div className='flex flex-col gap-2'>
            <Breadcrumbs aria-label='Page navigation' color='primary' data-testid='breadcrumbs-basic' size='md'>
                <Breadcrumbs.Item href='#' prefix={Home} tooltip={{ content: 'Go to home page' }}>
                    Home
                </Breadcrumbs.Item>
                <Breadcrumbs.Item href='#'>Products</Breadcrumbs.Item>
                <Breadcrumbs.Item href='#'>Electronics</Breadcrumbs.Item>
                <Breadcrumbs.Current>Laptops</Breadcrumbs.Current>
            </Breadcrumbs>
        </div>
        <div className='flex flex-col gap-2'>
            <Breadcrumbs aria-label='Settings navigation' color='primary' data-testid='breadcrumbs-disabled' size='md'>
                <Breadcrumbs.Item href='#'>Dashboard</Breadcrumbs.Item>
                <Breadcrumbs.Item href='#' isDisabled tooltip={{ content: 'Access restricted' }}>
                    Admin
                </Breadcrumbs.Item>
                <Breadcrumbs.Current>Settings</Breadcrumbs.Current>
            </Breadcrumbs>
        </div>
        <div className='flex flex-col gap-2'>
            <Breadcrumbs aria-label='File navigation' color='primary' data-testid='breadcrumbs-icons' size='md'>
                <Breadcrumbs.Item href='#' prefix={Folder}>
                    Documents
                </Breadcrumbs.Item>
                <Breadcrumbs.Item href='#' prefix={Folder}>
                    Projects
                </Breadcrumbs.Item>
                <Breadcrumbs.Current prefix={File}>Report.pdf</Breadcrumbs.Current>
            </Breadcrumbs>
        </div>
    </>
);
const ProgressDemo: FC = () => (
    <>
        <div className='flex flex-col gap-2 w-64'>
            <Progress
                aria-label='Loading progress'
                color='primary'
                data-testid='progress-determinate'
                label='Loading...'
                showValue
                size='md'
                value={65}
            />
        </div>
        <div className='flex flex-col gap-2 w-64'>
            <Progress
                aria-label='Uploading'
                color='primary'
                data-testid='progress-indeterminate'
                isIndeterminate
                label='Uploading files...'
                size='md'
            />
        </div>
        <div className='flex flex-col gap-2 w-64'>
            <Progress
                aria-label='Download progress'
                color='primary'
                data-testid='progress-custom'
                formatValue={(p) => `${Math.round(p * 10)}MB / 1GB`}
                label='Downloading'
                maxValue={1000}
                showValue
                size='md'
                value={420}
            />
        </div>
        <div className='flex flex-col gap-2 w-64'>
            <Progress
                aria-label='Task completion'
                color='primary'
                data-testid='progress-tooltip'
                label='Tasks'
                showValue
                size='md'
                tooltip={{ content: '25 of 100 tasks completed' }}
                value={25}
            />
        </div>
        <div className='flex flex-col gap-2'>
            <Progress
                aria-label='Circular progress'
                color='primary'
                data-testid='progress-circular'
                shape='circular'
                showValue
                size='md'
                value={75}
            />
        </div>
        <div className='flex flex-col gap-2'>
            <Progress
                aria-label='Completed'
                centerIcon={Check}
                color='primary'
                data-testid='progress-circular-icon'
                label='Complete'
                shape='circular'
                size='md'
                value={100}
            />
        </div>
        <div className='flex flex-col gap-2'>
            <Progress
                aria-label='Loading'
                color='primary'
                data-testid='progress-circular-indeterminate'
                isIndeterminate
                label='Loading...'
                shape='circular'
                size='md'
            />
        </div>
    </>
);
const DrawerDemo: FC = () => (
    <>
        {/* Bottom Drawer - mobile sheet style */}
        <Drawer
            color='primary'
            data-testid='drawer-bottom'
            direction='bottom'
            size='md'
            trigger={
                <Button
                    children={{ default: 'Bottom Drawer' }}
                    color='primary'
                    prefix={Menu}
                    size='md'
                    variant='outline'
                />
            }
        >
            <Drawer.Handle />
            <Drawer.Header>
                <Drawer.Title>Bottom Drawer</Drawer.Title>
                <Drawer.Description>Mobile-style sheet sliding up from bottom.</Drawer.Description>
            </Drawer.Header>
            <Drawer.Body>
                <p>Gesture-driven drawer with swipe-to-dismiss. Perfect for action sheets and mobile interfaces.</p>
            </Drawer.Body>
            <Drawer.Footer>
                <Drawer.Close>
                    <Button children={{ default: 'Cancel' }} color='primary' size='sm' variant='ghost' />
                </Drawer.Close>
                <Button children={{ default: 'Confirm' }} color='primary' size='sm' variant='solid' />
            </Drawer.Footer>
        </Drawer>

        {/* Left Drawer - navigation panel */}
        <Drawer
            color='primary'
            data-testid='drawer-left'
            direction='left'
            size='md'
            trigger={
                <Button
                    children={{ default: 'Left Panel' }}
                    color='primary'
                    prefix={PanelLeft}
                    size='md'
                    variant='outline'
                />
            }
        >
            <Drawer.Header>
                <Drawer.Title>Navigation</Drawer.Title>
            </Drawer.Header>
            <Drawer.Body>
                <p>Left side panel for navigation menus, settings trees, or sidebar content.</p>
            </Drawer.Body>
            <Drawer.Footer>
                <Drawer.Close>
                    <Button children={{ default: 'Close' }} color='primary' size='sm' variant='ghost' />
                </Drawer.Close>
            </Drawer.Footer>
        </Drawer>

        {/* Right Drawer - settings/inspector panel */}
        <Drawer
            color='primary'
            data-testid='drawer-right'
            direction='right'
            size='md'
            trigger={
                <Button
                    children={{ default: 'Settings' }}
                    color='primary'
                    prefix={Settings}
                    size='md'
                    variant='outline'
                />
            }
        >
            <Drawer.Header>
                <Drawer.Title>Settings</Drawer.Title>
                <Drawer.Description>Configure application preferences.</Drawer.Description>
            </Drawer.Header>
            <Drawer.Body>
                <p>Right drawer for settings panels, inspectors, or detail views.</p>
            </Drawer.Body>
            <Drawer.Footer>
                <Drawer.Close>
                    <Button children={{ default: 'Cancel' }} color='primary' size='sm' variant='ghost' />
                </Drawer.Close>
                <Button children={{ default: 'Save' }} color='primary' size='sm' variant='solid' />
            </Drawer.Footer>
        </Drawer>

        {/* Nested Drawer */}
        <Drawer
            color='primary'
            data-testid='drawer-nested-outer'
            direction='bottom'
            size='lg'
            trigger={<Button children={{ default: 'Nested Drawers' }} color='primary' size='md' variant='solid' />}
        >
            <Drawer.Handle />
            <Drawer.Header>
                <Drawer.Title>Outer Drawer</Drawer.Title>
                <Drawer.Description>Click to open nested drawer inside.</Drawer.Description>
            </Drawer.Header>
            <Drawer.Body>
                <Drawer
                    color='primary'
                    data-testid='drawer-nested-inner'
                    direction='bottom'
                    nested
                    size='md'
                    trigger={
                        <Button children={{ default: 'Open Nested' }} color='primary' size='sm' variant='outline' />
                    }
                >
                    <Drawer.Handle />
                    <Drawer.Header>
                        <Drawer.Title>Nested Drawer</Drawer.Title>
                    </Drawer.Header>
                    <Drawer.Body>
                        <p>This is a nested drawer using Vaul.NestedRoot.</p>
                    </Drawer.Body>
                    <Drawer.Footer>
                        <Drawer.Close>
                            <Button children={{ default: 'Close' }} color='primary' size='sm' variant='ghost' />
                        </Drawer.Close>
                    </Drawer.Footer>
                </Drawer>
            </Drawer.Body>
            <Drawer.Footer>
                <Drawer.Close>
                    <Button children={{ default: 'Close Outer' }} color='primary' size='sm' variant='ghost' />
                </Drawer.Close>
            </Drawer.Footer>
        </Drawer>
    </>
);

// --- [ENTRY_POINT] -----------------------------------------------------------

const AppContent: FC = () => (
    <main className='min-h-screen bg-(--color-surface-500) p-8'>
        <div className='mx-auto flex max-w-4xl flex-col gap-8'>
            <header className='flex flex-col gap-2'>
                <h1 className='text-2xl font-bold text-(--color-text-500)'>Component Test Harness</h1>
                <p className='text-sm text-(--color-text-700)'>
                    Minimal validation: async states, multiline fields, searchable selects.
                </p>
            </header>
            <Section title='Button Variants'>
                <Button children={{ default: 'Primary' }} color='primary' size='md' variant='solid' />
                <Button children={{ default: 'Outline' }} color='primary' size='md' variant='outline' />
                <Button children={{ default: 'Ghost' }} color='primary' size='md' variant='ghost' />
            </Section>
            <Section title='Async Button States'>
                <AsyncButtonDemo />
            </Section>
            <Section title='TextField Components'>
                <TextFieldDemo />
            </Section>
            <Section title='Select Components'>
                <SelectDemo />
            </Section>
            <Section title='Toolbar Components'>
                <ToolbarDemo />
            </Section>
            <Section title='Slider Components'>
                <SliderDemo />
            </Section>
            <Section title='ColorPicker Components'>
                <ColorPickerDemo />
            </Section>
            <Section title='DatePicker Components'>
                <DatePickerDemo />
            </Section>
            <Section title='Tree Components'>
                <TreeDemo />
            </Section>
            <Section title='TagGroup Components'>
                <TagGroupDemo />
            </Section>
            <Section title='Table Components'>
                <TableDemo />
            </Section>
            <Section title='GridList Components'>
                <GridListDemo />
            </Section>
            <Section title='Breadcrumbs Components'>
                <BreadcrumbsDemo />
            </Section>
            <Section title='Progress Components'>
                <ProgressDemo />
            </Section>
            <Section title='Drawer Components'>
                <DrawerDemo />
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
