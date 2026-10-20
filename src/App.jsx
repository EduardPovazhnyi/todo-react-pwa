import { useState, useRef, useEffect } from "react";
import Form from "./components/Form";
import FilterButton from "./components/FilterButton";
import Todo from "./components/Todo";
import { nanoid } from "nanoid";

function usePrevious(value) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

const FILTER_MAP = {
  All: () => true,
  Active: (task) => !task.completed,
  Completed: (task) => task.completed,
};

const FILTER_NAMES = Object.keys(FILTER_MAP);

function App(props) {
  function usePersistedState(key, defaultValue) {
    const [state, setState] = useState(() => {
      const saved = localStorage.getItem(key);
      return saved !== null ? JSON.parse(saved) : defaultValue;
    });

    useEffect(() => {
      localStorage.setItem(key, JSON.stringify(state));
    }, [key, state]);

    return [state, setState];
  }
  const [tasks, setTasks] = usePersistedState("tasks", props.tasks);
  const [filter, setFilter] = useState("All");
  const [lastInsertedId, setLastInsertedId] = useState("");
  useEffect(() => {
  if (lastInsertedId) {
    geoFindMe(lastInsertedId);
  }
}, [lastInsertedId]);

  function toggleTaskCompleted(id) {
    const updatedTasks = tasks.map((task) => {
      // if this task has the same ID as the edited task
      if (id === task.id) {
        // use object spread to make a new obkect
        // whose `completed` prop has been inverted
        return { ...task, completed: !task.completed };
      }
      return task;
    });
    setTasks(updatedTasks);
  }

  function deleteTask(id) {
    const remainingTasks = tasks.filter((task) => id !== task.id);
    setTasks(remainingTasks);
  }

  function editTask(id, newName) {
    const editedTaskList = tasks.map((task) => {
      // if this task has the same ID as the edited task
      if (id === task.id) {
        // Copy the task and update its name
        return { ...task, name: newName };
      }
      // Return the original task if it's not the edited task
      return task;
    });
    setTasks(editedTaskList);
  }

  function locateTask(id, location) {
  console.log("Locating task:", id, location);

  setTasks((previousTasks) =>
    previousTasks.map((task) =>
      task.id === id ? { ...task, location: location } : task
    )
  );
}

function geoFindMe(id) {
  if (!navigator.geolocation) {
    locateTask(id, {
      latitude: "##",
      longitude: "##",
      error: "Geolocation is not supported by your browser",
    });
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      locateTask(id, {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        error: "",
      });
    },
    (error) => {
      locateTask(id, {
        latitude: "##",
        longitude: "##",
        error: error.message,
      });
    }
  );
}

  const taskList = tasks
    ?.filter(FILTER_MAP[filter])
    .map((task) => (
      <Todo
        id={task.id}
        name={task.name}
        completed={task.completed}
        key={task.id}
        toggleTaskCompleted={toggleTaskCompleted}
        deleteTask={deleteTask}
        editTask={editTask}
        latitude={task.location?.latitude}
        longitude={task.location?.longitude}
      />
    ));

  const filterList = FILTER_NAMES.map((name) => (
    <FilterButton
      key={name}
      name={name}
      isPressed={name === filter}
      setFilter={setFilter}
    />
  ));

  function addTask(name) {
  const id = "todo-" + nanoid();

  const newTask = {
    id: id,
    name: name,
    completed: false,
    location: {
      latitude: "##",
      longitude: "##",
      error: "##",
    },
  };

  setLastInsertedId(id);
  setTasks((previousTasks) => [...previousTasks, newTask]);
}

  const tasksNoun = taskList.length !== 1 ? "tasks" : "task";
  const headingText = `${taskList.length} ${tasksNoun} remaining`;

  const listHeadingRef = useRef(null);
  const prevTaskLength = usePrevious(tasks.length);

  useEffect(() => {
    if (tasks.length < prevTaskLength) {
      listHeadingRef.current.focus();
    }
  }, [tasks.length, prevTaskLength]);

  return (
    <div className="todoapp stack-large">
      <h1>TodoMatic</h1>
      <Form addTask={addTask} />
      <div className="filters btn-group stack-exception">{filterList}</div>
      <h2 id="list-heading" tabIndex="-1" ref={listHeadingRef}>
        {headingText}
      </h2>
      <ul
        aria-labelledby="list-heading"
        className="todo-list stack-large stack-exception"
        role="list"
      >
        {taskList}
      </ul>
    </div>
  );
}

export default App;
